# Cloudflare Tunnel setup

This project can expose the API, LiveKit signaling, and the object-store API through **one Cloudflare Tunnel** with separate public hostnames. PostgreSQL can also be exposed as an opt-in TCP route for remote administration. No inbound ports need to be opened on the host.

Redis is intentionally **not** routed through the tunnel. It is a raw TCP service and should stay private. See [Security notes](#security-notes).

## 1. Log in to Cloudflare

Install `cloudflared` on the host, then run:

```sh
cloudflared tunnel login
```

Choose the Cloudflare zone that owns the domain. This writes an origin certificate to `~/.cloudflared/cert.pem`. The command can also print a URL to open if it cannot launch a browser.

## 2. Create the tunnel

```sh
cloudflared tunnel create ngumpul
```

The command prints a tunnel UUID and writes credentials to `~/.cloudflared/<UUID>.json`. Copy the credentials into this repository's gitignored `cloudflared/` directory and make them readable by the container's non-root user:

```sh
mkdir -p cloudflared
cp ~/.cloudflared/<UUID>.json cloudflared/<UUID>.json
chmod 755 cloudflared
chmod 644 cloudflared/<UUID>.json
```

Create `cloudflared/config.yml`:

```yaml
tunnel: <UUID>
credentials-file: /etc/cloudflared/<UUID>.json

ingress:
    - hostname: api.afadhili.my.id
      service: http://app:3000
    - hostname: livekit.afadhili.my.id
      service: http://livekit:7880
    - hostname: storage.afadhili.my.id
      service: http://rustfs:9000
    - hostname: db.afadhili.my.id
      service: tcp://db:5432
    - service: http_status:404
```

Replace `afadhili.my.id` with your domain. Use the Docker service names exactly (`app`, `livekit`, `rustfs`) because cloudflared runs on the same Compose network. The credentials JSON and `cloudflared/config.yml` are ignored by Git; do not commit them.

Validate the ingress rules on the host:

```sh
cloudflared tunnel --config cloudflared/config.yml ingress validate
```

## 3. Create DNS routes

```sh
cloudflared tunnel route dns ngumpul api.afadhili.my.id
cloudflared tunnel route dns ngumpul livekit.afadhili.my.id
cloudflared tunnel route dns ngumpul storage.afadhili.my.id
cloudflared tunnel route dns ngumpul db.afadhili.my.id
```

Each command creates a CNAME pointing at `<UUID>.cfargotunnel.com`.

## 4. Start cloudflared

```sh
docker compose --profile tunnel up -d cloudflared
docker compose --profile tunnel logs -f cloudflared
```

The service mounts `./cloudflared` at `/etc/cloudflared` and runs the local config. It is behind the `tunnel` Compose profile, so it does not start during normal local development.

The container uses `restart: unless-stopped`, so it starts again when the Docker daemon starts. That only helps if Docker itself is enabled at boot:

```sh
sudo systemctl enable --now docker.service docker.socket containerd.service
systemctl is-enabled docker.service docker.socket containerd.service
```

`docker compose down` removes the container, so recreate it with the `tunnel` profile afterward. The `cloudflared access tcp` process used for database access is a separate client-side process and is never started automatically.

Verify the public routes:

```sh
curl -i https://api.afadhili.my.id/health
curl -I https://storage.afadhili.my.id/health
curl -I https://livekit.afadhili.my.id/
```

## 5. Database access (opt-in)

The `db` hostname uses Cloudflare's TCP transport, not plain PostgreSQL over the internet. Start a local forward on the client machine:

```sh
cloudflared access tcp --hostname db.afadhili.my.id --url 127.0.0.1:15432
```

Keep that process running, then connect a PostgreSQL client to `127.0.0.1:15432`:

```sh
psql "postgresql://pbp_server:YOUR_PASSWORD@127.0.0.1:15432/pbp_server"
```

Use port `15432` locally if the host already runs PostgreSQL on `5432`. `Ctrl+C` closes the forwarded connection; it does not stop the server-side tunnel.

If you run host-side commands such as `pnpm db:migrate` or `drizzle-kit` through the tunnel, set the host `DATABASE_URL` to the forwarded port:

```env
DATABASE_URL=postgresql://pbp_server:YOUR_PASSWORD@127.0.0.1:15432/pbp_server
```

Keep `DATABASE_URL_DOCKER` pointing at `db:5432`; the app container must continue to use the internal Compose network.

**Protect this hostname with Cloudflare Access before using it on an untrusted network.** The tunnel route only hides PostgreSQL from direct port scans; anyone who can run `cloudflared access tcp` and has database credentials can attempt a connection. In Zero Trust → Access → Applications, add a self-hosted application for `db.afadhili.my.id` with an allow policy for your identity, then authenticate with `cloudflared access tcp` when prompted.

## 6. Update public URLs

Set the public URLs in `.env` and restart the app:

```env
BETTER_AUTH_URL=https://api.afadhili.my.id
CORS_ORIGIN=https://your-frontend.example.com
LIVEKIT_PUBLIC_URL=wss://livekit.afadhili.my.id
S3_PUBLIC_ENDPOINT=https://storage.afadhili.my.id
```

`CORS_ORIGIN` is the frontend origin, which may be a separate hostname or a Cloudflare Pages project. It is also passed to RustFS as `RUSTFS_CORS_ALLOWED_ORIGINS`, so recreate both services after changing it:

```sh
docker compose up -d app rustfs
```

Notes:

- `BETTER_AUTH_URL` must be the exact public API origin, including `https`, so cookies and OAuth callbacks are correct.
- The browser must be able to reach `storage.afadhili.my.id` for presigned attachment URLs and previews.
- If the frontend is on a different origin, it must send cookies with `credentials: "include"`.
- Because the public API is HTTPS, Better Auth sets the session cookie with `Secure; SameSite=None`, which is required when the frontend is on a different site. The browser must still allow third-party cookies; if it does not, host the frontend on the same site as the API (for example `app.afadhili.my.id`) or proxy `/api` through the frontend origin.
- For local development, run the API with `pnpm dev` on `http://localhost:3000` and use `ws://localhost:7880`; the Compose app intentionally has no published host port because Cloudflare reaches it at `app:3000`. Add a local Compose override if you need to expose the container port.

## Security notes

- **PostgreSQL is exposed only through the opt-in `db` TCP route.** Use Cloudflare Access and a least-privilege database user for remote administration. Never expose Redis, and do not add a `tcp://` route for it.
- The tunnel terminates TLS at Cloudflare. Keep `BETTER_AUTH_URL` on `https` and do not disable the app's Origin checks.
- Consider adding Cloudflare Access in front of `storage.afadhili.my.id` only if your clients can send service tokens; presigned URLs are designed to be usable by browsers, so Access there can break previews.
- Keep the RustFS console private. Use an SSH tunnel or Cloudflare Access if you need it.
- Treat the tunnel credentials JSON and `cert.pem` as secrets. They are gitignored.

## LiveKit media limitation

Cloudflare Tunnel carries the LiveKit **signaling** WebSocket, but **not** the RTC media UDP ports `50000–50100`. A client may connect and still fail to publish/subscribe.

For production, choose one of:

1. **LiveKit Cloud** — point `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` at LiveKit Cloud and keep `LIVEKIT_PUBLIC_URL` on its `wss://` endpoint.
2. **Direct media ports** — expose LiveKit TCP `7881` and UDP `50000–50100` directly, while signaling can still use the tunnel.
3. **TURN/TLS on 443** — configure LiveKit's TURN/TLS listener; this requires a certificate and a publicly reachable TCP port, and is not provided by the HTTP tunnel alone.

Cloudflare Spectrum can proxy UDP/TCP, but it is a paid product and is not part of this Compose setup.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `502 Bad Gateway` | Hostname service is wrong, or the target container is not running. Use `docker compose ps -a` and `docker compose logs app`. If the app exited with a port-3000 conflict, make sure no local override publishes `3000`; the app itself has no host port. |
| `cloudflared` exits immediately | `cloudflared/config.yml` or the credentials JSON is missing/unreadable. Check `docker compose logs cloudflared`. |
| Tunnel shows no connections | The credentials file or tunnel UUID in `config.yml` is wrong. Re-run `cloudflared tunnel list`. |
| Login/cookie failures | `BETTER_AUTH_URL` must match the public API URL exactly. |
| CORS errors | Set `CORS_ORIGIN` to the exact frontend origin and restart the app. |
| Previews fail | `S3_PUBLIC_ENDPOINT` must be publicly reachable and match the hostname routed to `rustfs:9000`. |
| WebSocket fails | Cloudflare supports WebSockets, but confirm the app route and `Origin` allowlist. |
