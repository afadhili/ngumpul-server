# Ngumpul Server

Hono API server with Better Auth email/password authentication, Drizzle ORM, PostgreSQL, Redis-backed WebSocket chat, and a local LiveKit server.

## Project structure

```text
src/
  app.ts
  server.ts
  controllers/   # HTTP and WebSocket request handling
  models/        # Chat message types and validation
  routes/        # Hono route definitions
  services/      # Redis Pub/Sub and application services
  db/            # Drizzle connection, schema, and relations
  lib/           # Authentication setup
```

## Run locally

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env` and set distinct random `BETTER_AUTH_SECRET` and `LIVEKIT_API_SECRET` values. Generate each with `openssl rand -hex 32`; never reuse one secret for both services.
3. Start PostgreSQL and Redis with `docker compose up -d db redis`.
4. Apply the database migrations with `pnpm db:migrate`.
5. Start the API with `pnpm dev`.

The server listens on `http://localhost:3000` by default. `GET /health` is a health check, Better Auth is mounted at `/api/auth/*`, and `GET /api/me` returns the signed-in user or `401`.

`GET /api/users/search?username=...&mode=like|exact` searches usernames for signed-in users. `like` is the default and performs a case-insensitive partial match; `exact` performs a case-sensitive exact match. The response contains up to 20 matching users with `id`, `username`, `name`, and `image`. Username is optional during Better Auth email sign-up.

The realtime API uses authenticated WebSocket connections: `ws://localhost:3000/ws/dm?peerId=<friend-id>` for a friend conversation and `ws://localhost:3000/ws/channel?channelId=<channel-id>` for a server text channel. Both authenticate with the Better Auth session cookie and reject browser Origins that do not match `CORS_ORIGIN` or `BETTER_AUTH_URL`; channel sockets are revalidated while open and closed with code `4003` when membership is revoked. Send messages through the REST API; the sockets emit created, updated, deleted, and receipt events. Redis Pub/Sub distributes events between app instances.

Email/password auth is enabled. Better Auth provides endpoints including:

- `POST /api/auth/sign-up/email`
- `POST /api/auth/sign-in/email`
- `POST /api/auth/sign-out`
- `GET /api/auth/get-session`

Google sign-in is available through Better Auth when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. Create a Google OAuth Web client and add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI, then set both values in `.env` and restart the app. The client can start sign-in with `POST /api/auth/sign-in/social` using `{ "provider": "google", "callbackURL": "http://localhost:5173/" }`. Better Auth builds the callback from `BETTER_AUTH_URL` and the `/api/auth/callback/google` path.

Account endpoints include Better Auth `POST /api/auth/change-password` (requires the current password), `POST /api/users/:userId/block`, `DELETE /api/users/:userId/block`, `GET /api/blocks`, and `POST /api/users/:userId/reports`. `GET/PUT /api/privacy` controls profile photo and presence visibility using `everyone`, `friends`, or `nobody`; username search applies photo visibility and block rules. Online and last-seen visibility settings are stored for the presence backend to enforce when presence is implemented.

Email verification is required for password and Google sign-in. Sign-up sends a six-digit OTP, valid for ten minutes, through SMTP. Verify it with `POST /api/auth/email-otp/verify-email` and `{ "email": "...", "otp": "..." }`; request another with `POST /api/auth/email-otp/send-verification-otp` and `{ "email": "...", "type": "email-verification" }`. The API never returns the OTP.

Password reset uses the same one-time code instead of a reset link. Request a code with `POST /api/auth/email-otp/request-password-reset` and `{ "email": "..." }`, then submit `POST /api/auth/email-otp/reset-password` with `{ "email": "...", "otp": "...", "password": "..." }`. The response to the request is generic so unknown emails cannot be enumerated; the code expires after ten minutes, allows five attempts, and is consumed on success; existing sessions are revoked when the password changes.

Verification, reset, sign-in, and email-change messages use a branded responsive HTML template (with a plain-text fallback), a purpose-specific subject, an expiry reminder, and a warning not to share the code. Compose routes email to Mailpit for local development; production should set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_FROM` (and use matching `*_DOCKER` overrides when running the app container).

Set `BETTER_AUTH_URL` to the public origin of the API and `CORS_ORIGIN` to the frontend origin when using a separate browser client. Browser requests that use cookies should include credentials. `DATABASE_URL` is for running the API from your host; `DATABASE_URL_DOCKER` is used by Compose, where PostgreSQL is reached by the `db` service name. Compose reads PostgreSQL database, username, password, and published port from the corresponding `.env` values.

## Cloudflare Tunnel

To expose the API, LiveKit signaling, and object storage through one tunnel with separate hostnames, see [CLOUDFLARE_TUNNEL.md](CLOUDFLARE_TUNNEL.md). The optional `cloudflared` service uses a locally-managed tunnel config under the gitignored `cloudflared/` directory and starts with:

```sh
docker compose --profile tunnel up -d cloudflared
```

PostgreSQL can be exposed as an opt-in TCP route for remote administration; see [CLOUDFLARE_TUNNEL.md](CLOUDFLARE_TUNNEL.md#5-database-access-opt-in). Redis is deliberately not routed through the tunnel. LiveKit media (UDP) also cannot traverse an HTTP tunnel; use LiveKit Cloud, direct media ports, or TURN/TLS.

## Run the full stack with Docker

Copy `.env.example` to `.env`, set `BETTER_AUTH_SECRET`, then run:

```sh
docker compose up --build
```

Compose starts PostgreSQL, Redis, LiveKit, Silo (an S3-compatible object store), and Mailpit, then the app runs Drizzle migrations and serves the API internally on port `3000`. The app has no published host port: public traffic reaches it through the Cloudflare Tunnel at `https://api.afadhili.my.id`. For direct local API development, run `pnpm dev` (see above) or add a local Compose override that publishes `127.0.0.1:3000`. Redis is available on port `6379`; LiveKit signaling is available at `ws://localhost:7880` using `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from `.env`, which Compose passes to both the app and LiveKit. LiveKit media uses TCP `7881` and UDP ports `50000-50100`. The S3 API is available at `http://localhost:9000` and its console at `http://localhost:9001`; bucket `pbp-attachments` is created automatically and remains private. Mailpit captures outgoing development email at `http://localhost:8025` and accepts SMTP on port `1025`. PostgreSQL, Redis, and object data use named volumes. Their host ports are bound to `127.0.0.1`, so database, cache, and object-store services are not reachable from other machines. Development credentials in `.env.example` are local only; change them before exposing services.

The attachment API supports images, video, audio, and common document types. `POST /api/attachments/uploads` returns a short-lived signed multipart POST form and records a pending attachment scoped to a friend conversation or server text channel. Upload using all returned `upload.fields` plus the `file` form field, then call `POST /api/attachments/:attachmentId/complete`. Authorized participants can list metadata and request a temporary download URL at `GET /api/attachments/:attachmentId/download-url`. Every returned attachment also includes `previewUrl`, a stable public capability URL at `GET /api/attachments/:attachmentId/preview` that redirects to a short-lived inline S3 URL; this can be used directly in `<img>`, `<video>`, or `<audio>` elements. The preview URL requires no session, so anyone who possesses it can view the attachment; do not use it for secrets. The server validates the destination, declared type, size, membership, and the uploaded object's magic bytes before making it available. Configure `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` in `.env` to target a different S3-compatible provider.

Server-management endpoints are `PATCH/DELETE /api/servers/:serverId` (owner/admin edit, owner delete), `PATCH/DELETE /api/servers/:serverId/channels/:channelId` (owner/admin), `GET/POST /api/servers/:serverId/members` (list/add), and `PATCH/DELETE /api/servers/:serverId/members/:userId` (owner role changes; members may leave; owner/admin removal rules). Text-channel history and writes use `GET/POST /api/servers/:serverId/channels/:channelId/messages`; edit or delete with `PATCH/DELETE /api/servers/:serverId/channels/:channelId/messages/:messageId`. Listing supports `limit` and `before=<message-id>` pagination; sending accepts `text`, `attachmentId`, and `replyToMessageId`, and deletion requires `?scope=me|everyone`.

Direct messages are stored in PostgreSQL and require an active friendship. Use `GET /api/direct-messages/:peerId?limit=50` to read history, and `POST /api/direct-messages/:peerId` with `{ "text": "...", "replyToMessageId": "optional-id", "attachmentId": "optional-ready-attachment-id" }` to send text and/or an uploaded attachment. History supports `before=<message-id>` pagination. A recipient can acknowledge a message and earlier messages with `POST /api/direct-messages/:messageId/receipts` and `{ "status": "delivered" }` or `{ "status": "read" }`. The sender can edit with `PATCH /api/direct-messages/:messageId`; delete using `DELETE /api/direct-messages/:messageId?scope=me|everyone` (the scope must be explicit). Authenticated clients can subscribe to private events at `ws://localhost:3000/ws/dm?peerId=<friend-id>` using the Better Auth session cookie; message writes remain on REST.

## Database changes

Edit the schema in `src/db/schema/auth.ts`, create a migration with `pnpm db:generate`, then apply it with `pnpm db:migrate`.
