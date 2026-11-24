# ngumpul Backend API Reference

Complete endpoint and data contract for the ngumpul backend (project directory: `/home/fadh/Projects/javascript/pbp-server`).

This document covers:

- the application REST API under `/api`
- Better Auth endpoints under `/api/auth`
- the realtime WebSocket API under `/ws`
- the LiveKit voice integration
- the data each endpoint needs, the shapes it returns, and its access rules

The source of truth is the code in `src/routes`, `src/controllers`, `src/lib`, and `src/db/schema`. If this document and the code disagree, the code wins.

---

## 1. Base URLs and transports

| Service | Development URL | Notes |
| --- | --- | --- |
| REST API | `http://localhost:3000` | JSON over HTTP |
| Health | `http://localhost:3000/health` | Public |
| Better Auth | `http://localhost:3000/api/auth` | Cookie session endpoints |
| App WebSocket | `ws://localhost:3000/ws/dm?peerId=...` | Direct-message events |
| App WebSocket | `ws://localhost:3000/ws/channel?channelId=...` | Server text-channel events |
| App WebSocket | `ws://localhost:3000/ws/user` | Server lifecycle, notifications and reaction events for the caller |
| LiveKit signaling | `ws://localhost:7880` | Returned by the voice-token endpoint |
| LiveKit media | TCP `7881`, UDP `50000-50100` | Docker Compose development defaults |
| S3/MinIO upload | value of `upload.url` | Presigned POST returned by attachment API |
| Mailpit (development) | `http://localhost:8025` | Captures verification OTP email |

The API is mounted as follows:

```text
/health
/api/auth/*
/api/*
/api/servers/*
```

`/api/servers/invites/:code/join` is deliberately matched before the `/:serverId` routes.

---

## 2. Conventions

### 2.1 Authentication

Application endpoints accept either the Better Auth **session cookie** or a **bearer session token**.

- Browser clients should send credentials, for example `fetch(..., { credentials: "include" })`.
- The cookie is set by Better Auth sign-in/OTP success responses.
- When `BETTER_AUTH_URL` uses `https`, the session cookie is `Secure; SameSite=None` so a frontend on a different site can send it. The API must also list that exact frontend origin in `CORS_ORIGIN`.
- `SameSite=None` still requires the browser to allow third-party cookies. If the frontend is cross-site and the browser blocks them, use the bearer-token flow below.
- Native/non-browser clients can send the cookie in a `Cookie` header.
- **Bearer tokens:** `POST /api/auth/sign-in/email`, `/sign-in/email-otp`, `/email-otp/verify-email`, and the OAuth popup completion return a session `token`. Send it as `Authorization: Bearer <token>` on REST requests. The static frontend stores it in `localStorage` under `ngumpul_bearer_token`; this is a deliberate fallback for browsers that reject third-party cookies.
- A missing or expired session returns `401 { "error": "Unauthorized" }` on application endpoints.
- Better Auth endpoints return Better Auth-shaped errors, usually `{ "message": "...", "code": "..." }`.

Protected endpoints are marked **Auth: required** below. Some also require friendship, server membership, or a server role; those checks are described per endpoint.

### 2.2 Headers

```http
Content-Type: application/json
Cookie: better-auth.session_token=...
Authorization: Bearer <session-token>   # alternative to the cookie
Origin: http://localhost:5173
```

- `Content-Type: application/json` is required for JSON bodies.
- The attachment upload is the exception: it is a `multipart/form-data` POST directly to S3/MinIO using the returned presigned fields.
- Browser requests are subject to the CORS policy in section 2.6.
- WebSocket browser handshakes include the cookie automatically; a cross-site frontend may append `?token=<session-token>` instead. Non-browser clients must send `Cookie` or `?token=`.

### 2.3 JSON body limit

All `/api/*` requests (including `/api/auth/*`) are limited to **1 MiB** by the Hono `bodyLimit` middleware. A larger body returns:

```http
413 Content-Type: application/json

{ "error": "Request body must not exceed 1 MiB" }
```

Attachment file bytes do **not** pass through this limit. They go directly to S3/MinIO using a presigned POST whose size is limited by the attachment policy (up to 200 MiB for video).

### 2.4 Timestamps, IDs, and naming

- Timestamps are ISO 8601 strings in JSON, for example `2026-11-23T15:03:42.000Z`.
- Application entity IDs are UUID strings except Better Auth user/session IDs and invite codes.
- Better Auth user IDs are opaque strings; do not assume UUID format.
- Invite codes are 24-character base64url strings.
- Usernames are lowercase, 3–24 characters, matching `^[a-z0-9_]{3,24}$`.
- Channel names are normalized to lowercase and spaces become hyphens.
- Server and channel names are not unique globally; channel names are unique **per server**.

### 2.5 Pagination

Direct-message and channel-message lists use cursor pagination:

```text
GET ...?limit=50&before=<message-id>
```

- `limit` is an integer from `1` to `100`; default `50`.
- `before` is a message ID in the same DM conversation or channel.
- Results are returned oldest-to-newest, but the page is selected from newest backwards.
- `nextCursor` is the ID of the oldest message in the returned page, or `null` when the page was not full.
- Pass `nextCursor` as the next `before` value to load older messages.
- A cursor that is not part of the conversation/channel returns `400`.
- Deleted messages may remain in results as tombstones (`deletedAt` set, text/attachment null). Messages hidden with `scope=me` are excluded for that user.

Attachment listing is **not** paginated; it returns up to 100 ready attachments.

### 2.6 CORS and Origins

`src/app.ts` configures CORS from `CORS_ORIGIN`:

- exactly one allowed origin (no wildcard)
- credentials enabled
- allowed headers: `Content-Type`, `Authorization`
- allowed methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`
- exposed header: `Content-Length`
- preflight cache: 600 seconds

For a split frontend/backend deployment set, for example:

```dotenv
BETTER_AUTH_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:5173
```

The WebSocket server accepts a missing `Origin` (non-browser clients) but rejects any browser `Origin` that is not the origin of `CORS_ORIGIN` or `BETTER_AUTH_URL` with HTTP `403`.

### 2.7 Rate limits

Better Auth rate limiting is enabled even outside production.

| Area | Limit |
| --- | --- |
| Better Auth global default | 100 requests / 60 seconds |
| `/sign-in/*`, `/sign-up/*`, `/change-password*`, `/change-email*` | 3 requests / 10 seconds |
| `/email-otp/send-verification-otp` | 3 requests / 60 seconds |
| `/email-otp/check-verification-otp`, `/email-otp/verify-email` | 3–10 requests / 60 seconds |
| `/email-otp/request-password-reset` | 3 requests / 60 seconds |
| `/email-otp/reset-password` | 10 requests / 60 seconds |
| Application REST endpoints | No application-level rate limit; use a reverse proxy in production |

Rate-limited requests return `429` with a Better Auth error message. Rate-limit storage is in-memory per app instance unless Better Auth is configured with shared storage.

### 2.8 Error shape and status codes

Application routes return:

```json
{ "error": "Human-readable explanation" }
```

Better Auth routes usually return:

```json
{ "message": "Human-readable explanation", "code": "MACHINE_CODE" }
```

| Status | Meaning in this API |
| --- | --- |
| `200` | Successful read/update |
| `201` | Resource created (message, server, channel, invite, upload, member, friend request, report) |
| `204` | Successful deletion or no-content action |
| `400` | Validation failure, invalid cursor, invalid JSON, bad scope |
| `401` | No/expired session |
| `403` | Authenticated but not allowed (friendship, membership, role, Origin) |
| `404` | Resource not found, or hidden to avoid leaking existence |
| `409` | Duplicate/conflict (already friends, pending request, duplicate member/channel, reused attachment, missing upload object) |
| `410` | Expired upload authorization or expired/used invite |
| `413` | JSON body over 1 MiB, or attachment larger than its type limit |
| `415` | Attachment MIME type not allowed |
| `429` | Better Auth rate limit |
| `500` | Unhandled server error |
| `502` | Object storage failed while deleting/finalizing an attachment |
| `503` | S3/LiveKit configuration or storage unavailable |

---

## 3. Complete endpoint index

### 3.1 Application REST endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Health check |
| `GET` | `/api/me` | Current Better Auth user |
| `GET` | `/api/profile` | Current profile |
| `PUT` | `/api/profile` | Update username/profile fields |
| `GET` | `/api/users/search` | Search public users by username prefix |
| `GET` | `/api/blocks` | List users blocked by caller |
| `POST` | `/api/users/:userId/block` | Block a user |
| `DELETE` | `/api/users/:userId/block` | Unblock a user |
| `POST` | `/api/users/:userId/reports` | Report a user |
| `GET` | `/api/privacy` | Read privacy settings |
| `PUT` | `/api/privacy` | Update privacy settings |
| `GET` | `/api/friends` | List friends |
| `GET` | `/api/friends/requests` | List pending incoming/outgoing requests |
| `POST` | `/api/friends/requests` | Send a friend request by username |
| `POST` | `/api/friends/requests/:requestId/accept` | Accept an incoming request |
| `POST` | `/api/friends/requests/:requestId/decline` | Decline an incoming request |
| `POST` | `/api/friends/requests/:requestId/cancel` | Cancel an outgoing request |
| `DELETE` | `/api/friends/:userId` | Remove a friend |
| `GET` | `/api/direct-messages/:peerId` | List a DM conversation |
| `POST` | `/api/direct-messages/:peerId` | Send a DM |
| `PATCH` | `/api/direct-messages/:messageId` | Edit own DM |
| `DELETE` | `/api/direct-messages/:messageId` | Delete/hide a DM |
| `POST` | `/api/direct-messages/:messageId/receipts` | Mark delivered/read |
| `POST` | `/api/direct-messages/:messageId/reactions` | Add an emoji reaction to a DM |
| `DELETE` | `/api/direct-messages/:messageId/reactions/:emoji` | Remove an emoji reaction from a DM |
| `GET` | `/api/attachments` | List ready conversation attachments |
| `POST` | `/api/attachments/uploads` | Start an upload and get a presigned POST |
| `POST` | `/api/attachments/:attachmentId/complete` | Finalize an upload |
| `GET` | `/api/attachments/:attachmentId/download-url` | Get an authenticated temporary download URL |
| `GET` | `/api/attachments/:attachmentId/preview` | Public preview redirect |
| `DELETE` | `/api/attachments/:attachmentId` | Delete an owned attachment |
| `GET` | `/api/servers` | List joined servers |
| `POST` | `/api/servers` | Create a server |
| `POST` | `/api/servers/invites/:code/join` | Join a server by invite code |
| `PATCH` | `/api/servers/:serverId` | Update server metadata |
| `DELETE` | `/api/servers/:serverId` | Delete a server |
| `GET` | `/api/servers/:serverId/channels` | List channels |
| `POST` | `/api/servers/:serverId/channels` | Create a text/voice channel |
| `PATCH` | `/api/servers/:serverId/channels/:channelId` | Update channel metadata |
| `DELETE` | `/api/servers/:serverId/channels/:channelId` | Delete a channel |
| `POST` | `/api/servers/:serverId/channels/:channelId/voice-token` | Get a LiveKit token |
| `GET` | `/api/servers/:serverId/channels/:channelId/messages` | List channel messages |
| `POST` | `/api/servers/:serverId/channels/:channelId/messages` | Send a channel message |
| `PATCH` | `/api/servers/:serverId/channels/:channelId/messages/:messageId` | Edit own channel message |
| `DELETE` | `/api/servers/:serverId/channels/:channelId/messages/:messageId` | Delete/hide a channel message |
| `POST` | `/api/servers/:serverId/channels/:channelId/messages/:messageId/reactions` | Add an emoji reaction to a channel message |
| `DELETE` | `/api/servers/:serverId/channels/:channelId/messages/:messageId/reactions/:emoji` | Remove an emoji reaction from a channel message |
| `GET` | `/api/servers/:serverId/members` | List server members |
| `POST` | `/api/servers/:serverId/members` | Add a member directly |
| `PATCH` | `/api/servers/:serverId/members/:userId` | Change a member role |
| `DELETE` | `/api/servers/:serverId/members/:userId` | Remove a member or leave |
| `POST` | `/api/servers/:serverId/invites` | Create an invite |

### 3.2 Better Auth REST endpoints

All paths below are relative to `/api/auth`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/ok` | Auth service health |
| `GET` | `/error` | Auth error page |
| `POST` | `/sign-up/email` | Create an email/password account |
| `POST` | `/sign-in/email` | Sign in with email/password |
| `POST` | `/sign-in/email-otp` | Sign in (or register) with an email OTP |
| `POST` | `/sign-in/social` | Start Google OAuth sign-in (same-site/native) |
| `GET` | `/google/start` | Start Google OAuth with a first-party top-level navigation (fallback) |
| `GET` | `/oauth-popup/start` | Start Google OAuth in a popup; completion posts the session token to `popupOrigin` |
| `GET`, `POST` | `/callback/:id` | OAuth callback (`:id` = `google`) |
| `GET`, `POST` | `/get-session` | Read the current session |
| `POST` | `/sign-out` | Clear the session |
| `POST` | `/update-user` | Update `name`/`image` |
| `POST` | `/update-session` | Update session metadata |
| `POST` | `/change-password` | Change password |
| `POST` | `/change-email` | Start an email change |
| `POST` | `/delete-user` | Delete the account |
| `GET` | `/delete-user/callback` | Account-deletion callback |
| `GET` | `/list-sessions` | List active sessions |
| `POST` | `/revoke-session` | Revoke one session |
| `POST` | `/revoke-sessions` | Revoke all sessions |
| `POST` | `/revoke-other-sessions` | Revoke all except current |
| `POST` | `/email-otp/send-verification-otp` | Send a 6-digit OTP |
| `POST` | `/email-otp/check-verification-otp` | Check an OTP |
| `POST` | `/email-otp/verify-email` | Verify email with an OTP |
| `POST` | `/email-otp/request-password-reset` | Send a password-reset OTP |
| `POST` | `/email-otp/reset-password` | Reset password with OTP |
| `POST` | `/email-otp/request-email-change` | Send an OTP to a new email |
| `POST` | `/email-otp/change-email` | Complete an email change with OTP |
| `POST` | `/request-password-reset` | Request a reset link (link email is not configured; use OTP) |
| `POST` | `/reset-password` | Reset with a token |
| `GET` | `/reset-password/:token` | Reset-password callback |
| `GET` | `/verify-email` | Verify email with a link token |
| `POST` | `/send-verification-email` | Resend a verification link (link email is not configured; use OTP) |
| `GET` | `/account-info` | Account information |
| `GET` | `/list-accounts` | Linked provider accounts |
| `POST` | `/link-social` | Link a social provider |
| `POST` | `/unlink-account` | Unlink a provider |
| `POST` | `/refresh-token` | Refresh an OAuth access token |
| `POST` | `/get-access-token` | Get an OAuth access token |

`/forget-password/email-otp` also exists as a deprecated alias for `/email-otp/request-password-reset`.

### 3.3 WebSocket endpoints

| URL | Purpose |
| --- | --- |
| `ws://HOST/ws/dm?peerId=<userId>` | Direct-message events for the caller and `peerId` |
| `ws://HOST/ws/channel?channelId=<channelId>` | Events for one server text channel |

### 3.4 LiveKit endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/servers/:serverId/channels/:channelId/voice-token` | Issue a LiveKit JWT for a voice channel |

LiveKit's own signaling/media endpoints are served by LiveKit, not by this REST API. See section 8.

---

## 4. Core data shapes

These are the objects clients normally hold in state. Nullable values are explicit.

### 4.1 User

Returned by `/api/me`, Better Auth responses, and member/user lists.

```json
{
  "id": "jF0wvZ1qvAUBcpQ74ZVgSe6ZgmC4m0o4",
  "name": "Alice Example",
  "email": "alice@example.test",
  "emailVerified": true,
  "image": null,
  "username": "alice",
  "createdAt": "2026-11-23T14:00:00.000Z",
  "updatedAt": "2026-11-23T14:05:00.000Z"
}
```

`username` is nullable until the user calls `PUT /api/profile`. It is set by the application, not by Better Auth sign-up (`username` is declared `input: false`).

### 4.2 Profile (read)

`GET /api/profile` returns only these fields:

```json
{
  "profile": {
    "username": "alice",
    "displayName": "Alice",
    "bio": "Backend person",
    "avatar": "https://example.test/alice.png",
    "banner": null,
    "location": null,
    "website": null,
    "pronouns": null,
    "isPublic": true,
    "photoVisibility": "friends",
    "onlineStatusVisibility": "friends",
    "lastSeenVisibility": "friends"
  }
}
```

`banner`, `location`, `website`, and `pronouns` are currently read-only (no write endpoint). If a profile row does not exist yet, the profile fields other than `username` may be `null`; privacy reads use the documented defaults.

### 4.3 DirectMessage

```json
{
  "id": "3a7b8c9d-0000-4000-8000-000000000001",
  "senderId": "user-a",
  "recipientId": "user-b",
  "text": "hello",
  "attachmentId": null,
  "replyToMessageId": null,
  "status": "sent",
  "deliveredAt": null,
  "readAt": null,
  "editedAt": null,
  "deletedAt": null,
  "createdAt": "2026-11-23T14:10:00.000Z",
  "updatedAt": "2026-11-23T14:10:00.000Z",
  "reactions": []
}
```

`status` is `sent`, `delivered`, or `read`. `reactions` is an array of reaction summaries (section 4.8).

List/send responses add a `replyTo` field containing the parent `DirectMessage` or `null`.

### 4.4 ChannelMessage

```json
{
  "id": "0d9e8f7a-0000-4000-8000-000000000002",
  "channelId": "47b16513-cd94-4869-9cf5-7256834a1041",
  "senderId": "user-a",
  "text": "hello channel",
  "attachmentId": null,
  "replyToMessageId": null,
  "editedAt": null,
  "deletedAt": null,
  "createdAt": "2026-11-23T14:12:00.000Z",
  "updatedAt": "2026-11-23T14:12:00.000Z",
  "reactions": []
}
```

List/send responses add `replyTo` (parent `ChannelMessage` or `null`). `reactions` uses the same summaries as DMs (section 4.8).

### 4.5 Server and ServerChannel

Server:

```json
{
  "id": "4571c0f6-624c-4e7c-8ea4-1fe3d76bd25f",
  "name": "Ngumpul Dev",
  "description": "Development server",
  "icon": null,
  "ownerId": "user-a",
  "createdAt": "2026-11-23T14:20:00.000Z",
  "updatedAt": "2026-11-23T14:20:00.000Z"
}
```

Channel:

```json
{
  "id": "47b16513-cd94-4869-9cf5-7256834a1041",
  "serverId": "4571c0f6-624c-4e7c-8ea4-1fe3d76bd25f",
  "name": "general",
  "description": null,
  "kind": "text",
  "position": 0,
  "createdBy": "user-a",
  "createdAt": "2026-11-23T14:20:00.000Z",
  "updatedAt": "2026-11-23T14:20:00.000Z"
}
```

`kind` is `text` or `voice`.

### 4.6 Server member

```json
{
  "userId": "user-b",
  "username": "bob",
  "displayName": "Bob",
  "avatar": null,
  "role": "member",
  "joinedAt": "2026-11-23T14:22:00.000Z"
}
```

`role` is `owner`, `admin`, or `member`.

### 4.7 Attachment

Every attachment response uses the public shape below:

```json
{
  "id": "10243330-98e3-4dca-a300-933905f12ba7",
  "uploaderId": "user-a",
  "targetType": "channel",
  "targetId": "47b16513-cd94-4869-9cf5-7256834a1041",
  "fileName": "photo.png",
  "mimeType": "image/png",
  "sizeBytes": 12345,
  "uploadedAt": "2026-11-23T14:30:00.000Z",
  "createdAt": "2026-11-23T14:29:00.000Z",
  "previewUrl": "http://localhost:3000/api/attachments/10243330-98e3-4dca-a300-933905f12ba7/preview"
}
```

`targetType` is `direct` (target is the peer user ID) or `channel` (target is the channel ID).

`previewUrl` is a **public capability URL**. Anyone with that URL can view the attachment; see section 5.9.

### 4.8 Reaction summary

```json
{
  "emoji": "👍",
  "count": 2,
  "userIds": ["user-a", "user-b"],
  "me": true
}
```

`me` is present in REST responses (including message list/send/edit) and reports whether the caller reacted with that emoji. It is omitted from WebSocket `message_reaction` events. The same emoji can be added only once per user per message; reactions are removed automatically when a message is deleted.

---

## 5. Application REST endpoints

Every endpoint in this section requires a session unless explicitly marked public, and returns `401` without one.

### 5.1 Health

#### `GET /health`

Public. No body.

```json
{ "status": "ok" }
```

### 5.2 Current user and profile

#### `GET /api/me`

Returns the Better Auth session user.

```json
{
  "user": {
    "id": "jF0wvZ1qvAUBcpQ74ZVgSe6ZgmC4m0o4",
    "name": "Alice Example",
    "email": "alice@example.test",
    "emailVerified": true,
    "image": null,
    "username": "alice",
    "createdAt": "2026-11-23T14:00:00.000Z",
    "updatedAt": "2026-11-23T14:05:00.000Z"
  }
}
```

#### `GET /api/profile`

Returns the profile fields in section 4.2. `username` comes from the `user` table; the remaining fields come from `profile`.

#### `PUT /api/profile`

Auth: required.

Body:

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `username` | string | **yes** | Trimmed, lowercased, `^[a-z0-9_]{3,24}$`; unique case-insensitively; `409` if taken |
| `displayName` | string or null | no | Trimmed, at most 60 characters; empty becomes null |
| `bio` | string or null | no | At most 500 characters; empty becomes null |
| `avatar` | string or null | no | HTTP/HTTPS URL, at most 2048 characters |
| `isPublic` | boolean | no | Defaults to current value, or `true` for a new profile |

`username` is always required, even for an update. Fields not listed here (`banner`, `location`, `website`, `pronouns`) are not writable through this endpoint.

Response `200`:

```json
{
  "profile": {
    "id": "...",
    "userId": "...",
    "displayName": "Alice",
    "bio": "Backend person",
    "avatar": null,
    "banner": null,
    "location": null,
    "website": null,
    "pronouns": null,
    "isPublic": true,
    "photoVisibility": "friends",
    "onlineStatusVisibility": "friends",
    "lastSeenVisibility": "friends",
    "createdAt": "...",
    "updatedAt": "...",
    "username": "alice"
  }
}
```

Errors: `400` validation, `409` username already in use.

### 5.3 User discovery, blocks, reports, privacy

#### `GET /api/users/search`

Query parameters:

| Parameter | Required | Rules |
| --- | --- | --- |
| `username` | yes | 2–24 characters; lowercased; prefix match |

Returns up to 20 users, excluding:

- the caller
- users in a block relationship with the caller (either direction)
- users with a profile whose `isPublic` is `false`

`avatar` is included only when the target's `photoVisibility` is `everyone`, or is `friends` and the caller is a friend. Otherwise it is `null`.

```json
{
  "users": [
    {
      "userId": "user-b",
      "username": "bob",
      "displayName": "Bob",
      "avatar": null
    }
  ]
}
```

#### `GET /api/blocks`

```json
{
  "blocked": [
    {
      "userId": "user-b",
      "username": "bob",
      "name": "Bob Example",
      "displayName": "Bob",
      "blockedAt": "2026-11-23T14:35:00.000Z"
    }
  ]
}
```

#### `POST /api/users/:userId/block`

No body.

Effects:

- creates a block (idempotent)
- removes an existing friendship in either direction
- cancels the caller's pending outgoing request to the target
- declines the target's pending incoming request to the caller
- immediately closes direct-message WebSockets for the pair

Response: `204`. Errors: `400` self, `404` target missing.

#### `DELETE /api/users/:userId/block`

Response: `204`, or `404` if the user was not blocked.

#### `POST /api/users/:userId/reports`

Body:

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `reason` | string | yes | `spam`, `harassment`, `impersonation`, `inappropriate_content`, or `other` |
| `details` | string | no | At most 1000 characters |

Only one report per reporter/reported pair is allowed.

Response `201`:

```json
{
  "report": {
    "id": "...",
    "status": "open",
    "createdAt": "2026-11-23T14:36:00.000Z"
  }
}
```

Errors: `400` self/invalid reason/details, `404` target missing, `409` already reported.

#### `GET /api/privacy`

```json
{
  "privacy": {
    "photoVisibility": "friends",
    "onlineStatusVisibility": "friends",
    "lastSeenVisibility": "friends"
  }
}
```

If no profile row exists, the defaults above are returned.

#### `PUT /api/privacy`

Body: at least one of:

| Field | Allowed values |
| --- | --- |
| `photoVisibility` | `everyone`, `friends`, `nobody` |
| `onlineStatusVisibility` | `everyone`, `friends`, `nobody` |
| `lastSeenVisibility` | `everyone`, `friends`, `nobody` |

Response `200` returns the same shape as `GET /api/privacy`. Errors: `400` when no field or an invalid value is supplied.

### 5.4 Friends

#### `GET /api/friends`

```json
{
  "friends": [
    {
      "userId": "user-b",
      "username": "bob",
      "displayName": "Bob",
      "avatar": null
    }
  ]
}
```

#### `GET /api/friends/requests`

Only `pending` requests are returned.

```json
{
  "incoming": [
    {
      "id": "request-id",
      "userId": "user-b",
      "username": "bob",
      "displayName": "Bob",
      "createdAt": "2026-11-23T14:40:00.000Z"
    }
  ],
  "outgoing": []
}
```

#### `POST /api/friends/requests`

Body:

```json
{ "username": "bob" }
```

Rules:

- username must be 3–24 characters
- target must exist
- caller cannot add themselves
- a block in either direction returns `403`
- an existing friendship returns `409`
- a pending request in either direction returns `409`

Response `201`:

```json
{
  "request": {
    "id": "...",
    "requesterId": "user-a",
    "recipientId": "user-b",
    "status": "pending",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

#### `POST /api/friends/requests/:requestId/accept`

Only the recipient of a pending request can accept it. Accepting creates the canonical friendship pair.

Response `200`:

```json
{ "request": { "...": "full friend_request row with status accepted" } }
```

Errors: `404` if no pending incoming request matches.

#### `POST /api/friends/requests/:requestId/decline`

Only the recipient can decline a pending request.

Response `200` with the updated request row; `404` otherwise.

#### `POST /api/friends/requests/:requestId/cancel`

Only the requester can cancel a pending request.

Response `200` with the updated request row; `404` otherwise.

#### `DELETE /api/friends/:userId`

Removes the canonical friendship and revokes direct-message sockets for the pair.

Response: `204`, or `404` if not friends.

### 5.5 Direct messages

All DM endpoints require:

- a valid session
- a current friendship between the caller and the peer
- no block in either direction

Otherwise the endpoint returns `403` (or `404` where described). The friendship is canonical: the two user IDs are ordered lexicographically in the database.

#### `GET /api/direct-messages/:peerId`

Query: `limit`, `before` (section 2.5).

Response:

```json
{
  "messages": [
    {
      "...": "DirectMessage fields",
      "replyTo": null
    }
  ],
  "nextCursor": null
}
```

Messages are returned oldest-to-newest. Messages hidden for the caller are omitted; deleted messages remain as tombstones.

#### `POST /api/direct-messages/:peerId`

Body:

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `text` | string | one of text/attachment | Trimmed; max 4000 characters; empty becomes null |
| `attachmentId` | string | one of text/attachment | Must be a **ready** attachment owned by the caller with `targetType: "direct"` and `targetId` equal to `peerId` |
| `replyToMessageId` | string | no | Must be a message in this same conversation |

Response `201`:

```json
{
  "message": {
    "...": "DirectMessage fields",
    "replyTo": null
  }
}
```

Publishes a direct-message WebSocket `created` event.

#### `PATCH /api/direct-messages/:messageId`

Body:

```json
{ "text": "edited text" }
```

- caller must be the sender
- message must not be deleted
- text must be 1–4000 characters

Response `200`:

```json
{ "message": { "...": "DirectMessage fields" } }
```

Publishes an `updated` event.

#### `DELETE /api/direct-messages/:messageId?scope=me|everyone`

`scope` is required.

- `scope=me`: hides the message for the caller only; either participant may do this; response `204`; no WebSocket event.
- `scope=everyone`: only the sender may do this. The server deletes the attachment objects (if any), sets `text`/`attachmentId` to null, sets `deletedAt`, and emits a `deleted` event.

Response `204`. Errors: `400` invalid/missing scope, `403` non-sender deleting for everyone, `404` not found/not a participant, `502` attachment object deletion failed.

#### `POST /api/direct-messages/:messageId/receipts`

Body:

```json
{ "status": "read" }
```

Allowed values: `delivered`, `read`.

- caller must be the **recipient** of `:messageId`
- `delivered` advances only messages currently in `sent`
- `read` marks every incoming message from that peer up to and including the marker
- timestamps use `coalesce`, so an earlier timestamp is not overwritten

Response:

```json
{
  "status": "read",
  "upToMessageId": "...",
  "updatedCount": 4
}
```

Publishes a `receipt` event with the marker message record.

#### `POST /api/direct-messages/:messageId/reactions`

Body:

```json
{ "emoji": "👍" }
```

- caller must be a participant of the (non-deleted) DM and still have friend access (not blocked)
- `emoji` is trimmed, 1–32 characters, and cannot contain control characters
- adding the same emoji twice is idempotent
- response `200` with the message ID and updated summaries:

```json
{
  "messageId": "...",
  "reactions": [{ "emoji": "👍", "count": 2, "userIds": ["user-a", "user-b"], "me": true }]
}
```

Publishes a `message_reaction` `added` event to both participants and notifies the message sender when somebody else reacts. Errors: `400` invalid emoji/body, `401` unauthenticated, `403` blocked/unfriended, `404` message not found.

#### `DELETE /api/direct-messages/:messageId/reactions/:emoji`

`:emoji` is URL-encoded (for example `%F0%9F%91%8D`). The caller must be a participant with current access. Removing an absent reaction is idempotent; response `200` has the same shape as add. Publishes a `message_reaction` `removed` event only when a row was deleted.

### 5.6 Servers

Access roles are hierarchical:

```text
owner > admin > member
```

- `owner`: exactly the server creator in this implementation; can update/delete the server, manage roles, remove admins, create invites/channels.
- `admin`: can update server metadata, create/update/delete channels, add members, create invites, remove ordinary members; cannot change roles or delete the server.
- `member`: can read channels/members, send messages, join voice, create their own messages/receipts, leave the server.

#### `GET /api/servers`

Returns servers the caller is a member of, newest membership first.

```json
{
  "servers": [
    {
      "id": "...",
      "name": "Ngumpul Dev",
      "description": "Development server",
      "icon": null,
      "ownerId": "user-a",
      "role": "owner",
      "joinedAt": "2026-11-23T14:20:00.000Z"
    }
  ]
}
```

#### `POST /api/servers`

Body:

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `name` | string | yes | Trimmed, 2–80 characters |
| `description` | string or null | no | At most 500 characters |

Effects: creates the server, makes the caller `owner`, and creates a `general` text channel.

Response `201`:

```json
{
  "server": {
    "id": "...",
    "name": "Ngumpul Dev",
    "description": null,
    "icon": null,
    "ownerId": "user-a",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

#### `PATCH /api/servers/:serverId`

Access: owner or admin.

Body: at least one of:

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string | 2–80 characters |
| `description` | string or null | At most 500 characters |
| `icon` | string or null | HTTP/HTTPS URL, at most 2048 characters |

Response `200` with the full updated server row. Errors: `400` no fields/invalid, `403` role, `404` server/access.

#### `DELETE /api/servers/:serverId`

Access: owner only.

Deletes the server and its channels/members/invites/messages (database cascades), revokes all channel WebSockets for the server, and deletes channel attachment objects/rows.

Response: `204`. Errors: `403` not owner, `404`.

#### `POST /api/servers/:serverId/invites`

Access: owner or admin.

Body is optional; an empty body is accepted:

| Field | Type | Default | Rules |
| --- | --- | --- | --- |
| `expiresInSeconds` | integer or null | `604800` (7 days) | `60`–`2592000`, or `null` for no expiry |
| `maxUses` | integer or null | `null` | `1`–`1000`, or `null` for unlimited |

Response `201`:

```json
{
  "invite": {
    "code": "base64url-code",
    "serverId": "...",
    "expiresAt": "2026-11-30T14:20:00.000Z",
    "maxUses": null
  }
}
```

`uses` is not returned. There is no list/revoke-invite endpoint in the current API.

#### `POST /api/servers/invites/:code/join`

Body: none.

Rules:

- invite must exist
- invite must not be expired
- `maxUses` must not be reached
- caller must not already be a member

The invite `uses` counter is incremented atomically inside the join transaction.

Response `201`:

```json
{ "serverId": "...", "joined": true }
```

Errors: `404` invite not found, `409` already a member, `410` expired/use limit reached.

#### `GET /api/servers/:serverId/channels`

Access: any member.

Returns full channel rows ordered by `position` then `createdAt`:

```json
{ "channels": [ { "...": "ServerChannel fields" } ] }
```

#### `POST /api/servers/:serverId/channels`

Access: owner or admin.

Body:

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `name` | string | yes | Trimmed, lowercased, spaces→hyphens; `^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$` |
| `kind` | string | yes | `text` or `voice` |
| `description` | string or null | no | At most 500 characters |

Channel names are unique per server (`409` on duplicate). The new channel gets `max(position)+1`.

Response `201` with the full channel row.

#### `PATCH /api/servers/:serverId/channels/:channelId`

Access: owner or admin.

Body: at least one of:

| Field | Type | Rules |
| --- | --- | --- |
| `name` | string | Same channel-name rules; unique per server |
| `description` | string or null | At most 500 characters |
| `position` | integer | `0`–`1000000` |

`kind` is immutable. Response `200` with the full channel row. Errors: `400` invalid/no fields, `403`, `404`, `409` duplicate name.

#### `DELETE /api/servers/:serverId/channels/:channelId`

Access: owner or admin.

Deletes the channel and its messages, revokes channel WebSockets, and deletes channel attachment objects/rows.

Response: `204`. Errors: `403`, `404`.

### 5.7 Server members

#### `GET /api/servers/:serverId/members`

Access: any member.

```json
{
  "members": [
    {
      "userId": "user-a",
      "username": "alice",
      "displayName": "Alice",
      "avatar": null,
      "role": "owner",
      "joinedAt": "2026-11-23T14:20:00.000Z"
    }
  ]
}
```

Ordered by join time.

#### `POST /api/servers/:serverId/members`

Access: owner or admin.

Body: exactly one of:

```json
{ "username": "bob" }
```

or

```json
{ "userId": "user-b" }
```

The target is added with role `member`; there is no role parameter on this route.

Response `201`:

```json
{
  "member": {
    "userId": "user-b",
    "username": "bob",
    "role": "member"
  }
}
```

Errors: `400` no identifier, `403` role, `404` user/server, `409` already a member.

#### `PATCH /api/servers/:serverId/members/:userId`

Access: owner only.

Body:

```json
{ "role": "admin" }
```

Allowed roles: `admin`, `member`.

- the owner cannot change their own role (`400`)
- the owner's role cannot be changed by anyone (`403`)
- only existing members can be updated

Response `200` with the full `server_member` row (`serverId`, `userId`, `role`, `joinedAt`).

#### `DELETE /api/servers/:serverId/members/:userId`

Caller can:

- leave the server, unless they are the owner
- if owner/admin, remove another member
- owner can remove admins and members
- admin can remove ordinary members, but not admins
- the owner cannot be removed by anyone

Response: `204`. The removed user's channel WebSockets for that server are closed immediately.

### 5.8 Channel messages

All channel-message endpoints require:

- a valid session
- membership in the server that owns the channel
- a **text** channel (`kind: "text"`)

A voice channel or a channel outside the caller's servers returns `404` (deliberately not `403`, to avoid leaking existence).

#### `GET /api/servers/:serverId/channels/:channelId/messages`

Query: `limit`, `before` (section 2.5).

Response:

```json
{
  "messages": [
    {
      "...": "ChannelMessage fields",
      "replyTo": null
    }
  ],
  "nextCursor": null
}
```

Messages hidden for the caller are omitted. Deleted messages remain as tombstones. A `replyTo` parent is only resolved when it belongs to the same channel.

#### `POST /api/servers/:serverId/channels/:channelId/messages`

Body:

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `text` | string | one of text/attachment | Trimmed; max 4000 characters; empty becomes null |
| `attachmentId` | string | one of text/attachment | Ready attachment owned by caller, `targetType: "channel"`, `targetId: channelId` |
| `replyToMessageId` | string | no | Must be in the same channel |

Response `201`:

```json
{
  "message": {
    "...": "ChannelMessage fields",
    "replyTo": null
  }
}
```

An attachment can be linked to only one message. Reusing one returns `409`:

```json
{ "error": "Attachment is already attached to a message" }
```

Publishes a `channel_message` `created` event.

#### `PATCH /api/servers/:serverId/channels/:channelId/messages/:messageId`

Body:

```json
{ "text": "edited text" }
```

Only the sender can edit; the message must not be deleted; text must be 1–4000 characters.

Response `200` with the updated message. Publishes `updated`.

#### `DELETE /api/servers/:serverId/channels/:channelId/messages/:messageId?scope=me|everyone`

`scope` is required.

- `scope=me`: any current member can hide the message for themselves; `204`; no event.
- `scope=everyone`: allowed for the sender **or** a server owner/admin. Deletes the attachment objects, sets text/attachment null, sets `deletedAt`, emits `deleted`.

Response `204`. Errors: `400` invalid/missing scope, `403` not sender/manager, `404` channel/message/access, `502` attachment deletion failed.

#### `POST /api/servers/:serverId/channels/:channelId/messages/:messageId/reactions`

Body:

```json
{ "emoji": "❤️" }
```

- caller must currently be a member of the server and the channel must be a text channel
- same emoji rules and idempotency as DM reactions
- response `200` with `{ messageId, reactions }` (summaries include `me`)

Publishes a `message_reaction` `added` event to every server member on their `/ws/user` socket and notifies the message sender. Errors: `400` invalid emoji/body, `401` unauthenticated, `404` channel/message/access.

#### `DELETE /api/servers/:serverId/channels/:channelId/messages/:messageId/reactions/:emoji`

URL-encode the emoji. Removing an absent reaction is idempotent. Response `200` with updated summaries; publishes `removed` only when a row was deleted.

### 5.9 Attachments

#### Allowed types and size limits

| MIME type | Category | Maximum |
| --- | --- | --- |
| `image/jpeg`, `image/png`, `image/webp`, `image/gif` | image | 20 MiB |
| `video/mp4`, `video/webm`, `video/quicktime` | video | 200 MiB |
| `audio/mpeg`, `audio/mp4`, `audio/ogg`, `audio/webm`, `audio/wav`, `audio/x-m4a` | audio | 50 MiB |
| `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-powerpoint`, `application/vnd.openxmlformats-officedocument.presentationml.presentation` | document | 50 MiB |
| `text/plain` | document | 10 MiB |

Other MIME types return `415`.

#### `POST /api/attachments/uploads`

Auth: required.

Body:

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `targetType` | string | yes | `direct` or `channel` |
| `targetId` | string | yes | Peer user ID for direct, channel ID for channel; max 128 chars |
| `fileName` | string | yes | Sanitized; slashes/control chars replaced; max 180 chars |
| `mimeType` | string | yes | One of the types above |
| `sizeBytes` | integer | yes | 1 byte to the category limit |

Access rules:

- `targetType=direct`: caller must be a friend of `targetId` and not blocked
- `targetType=channel`: caller must be a member of the server and the channel must be `kind="text"`

Response `201`:

```json
{
  "attachment": {
    "id": "10243330-98e3-4dca-a300-933905f12ba7",
    "targetType": "channel",
    "targetId": "47b16513-cd94-4869-9cf5-7256834a1041",
    "fileName": "photo.png",
    "mimeType": "image/png",
    "sizeBytes": 12345
  },
  "upload": {
    "method": "POST",
    "url": "http://localhost:9000/pbp-attachments",
    "fields": {
      "key": "staging/...",
      "Content-Type": "image/png",
      "Policy": "...",
      "X-Amz-Algorithm": "...",
      "X-Amz-Credential": "...",
      "X-Amz-Date": "...",
      "X-Amz-Signature": "..."
    },
    "expiresAt": "2026-11-23T14:34:00.000Z"
  }
}
```

Upload protocol:

1. Build `multipart/form-data`.
2. Add every key/value from `upload.fields` as form fields.
3. Add the file as the `file` field.
4. POST to `upload.url`.
5. Call `POST /api/attachments/:attachmentId/complete`.

The presigned POST expires after 300 seconds and enforces the declared `Content-Type`, exact key, and `content-length-range 1..maxBytes`. Do not send the session cookie to S3.

Errors: `400` validation, `403` target access, `413` size too large, `415` MIME not allowed, `503` storage unavailable.

#### `POST /api/attachments/:attachmentId/complete`

Auth: required; caller must be the uploader.

No body.

Server checks, in order:

1. Attachment row belongs to caller.
2. If already `ready`, returns the existing attachment.
3. Upload authorization (`uploadExpiresAt`) has not expired; `410` otherwise and the row/upload object is removed.
4. The staging object exists (`HeadObject`); `409` if missing.
5. Object `ContentLength` equals `sizeBytes` and `ContentType` equals declared MIME; otherwise `400` and the pending row/object is removed.
6. Copies staging to the final object key with the declared content type/disposition.
7. Reads the first 4096 bytes and verifies magic bytes against the declared MIME; mismatch returns `400` and removes the object/row.

Response `200`:

```json
{ "attachment": { "...": "public Attachment shape including previewUrl" } }
```

Other errors: `404` not found, `502` storage finalization failure.

#### `GET /api/attachments?targetType=direct|channel&targetId=...`

Auth: required.

Access:

- direct: caller and `targetId` must be friends
- channel: caller must be a member of the server owning the text channel

Returns up to 100 **ready** attachments, ordered oldest-first.

```json
{ "attachments": [ { "...": "public Attachment shape" } ] }
```

For direct targets, both directions of the conversation are included.

Errors: `400` missing/invalid target, `403` no access.

#### `GET /api/attachments/:attachmentId/download-url`

Auth: required; attachment must be `ready` and the caller must have access to its target.

Response `200`:

```json
{
  "url": "http://localhost:9000/pbp-attachments/objects/...?X-Amz-...",
  "expiresInSeconds": 300
}
```

`Content-Disposition` is `inline` for image/audio/video and `attachment` for documents.

Errors: `404` missing/no access, `503` signing unavailable.

#### `GET /api/attachments/:attachmentId/preview`

**Public. No session required.**

Returns `302` to a short-lived (300 second) signed inline URL for a ready attachment.

Response headers include:

```http
Cache-Control: private, no-store
Cross-Origin-Resource-Policy: cross-origin
X-Robots-Tag: noindex, nofollow
```

This is a **capability URL**: anyone who has the URL can view the file. It is intended for `<img>`, `<video>`, and `<audio>` use; do not use it for secrets. The bucket itself stays private.

Errors: `404` missing, `503` signing unavailable.

#### `DELETE /api/attachments/:attachmentId`

Auth: required; caller must be the uploader.

Deletes the final and staging S3 objects, unlinks direct-message references, deletes the attachment row, and emits DM `updated`/`deleted` events where applicable.

Response `204`. Errors: `404` not found/not owner, `502` object deletion failure.

Channel messages should have their attachments removed through `DELETE /api/servers/:serverId/channels/:channelId/messages/:messageId` so the message tombstone/check constraint stays consistent.

---

## 6. Better Auth endpoints

Base path: `/api/auth`.

The auth service is configured with:

- email + password
- email OTP (`emailOTP` plugin)
- optional Google OAuth
- required email verification for email/password sign-in
- 6-digit OTPs, 600-second expiry, 5 attempts, hashed storage
- explicit rate limiting

### 6.1 Primary auth flows

#### Email/password flow

1. `POST /sign-up/email` with `{ name, email, password }`.
   Current config returns `200` with `token: null` and an unverified `user`; no session is created because email verification is required.
2. `POST /email-otp/send-verification-otp` with `{ email, type: "email-verification" }`.
3. Read the OTP from email (Mailpit in development) and call `POST /email-otp/verify-email` with `{ email, otp }`.
4. `POST /sign-in/email` with `{ email, password }` to obtain the session cookie.

#### Password reset with OTP

1. `POST /email-otp/request-password-reset` with `{ email }`.
   The response is always `{ "success": true }`, even for an unknown email, to avoid account enumeration.
2. Read the six-digit `forget-password` OTP from the branded email (Mailpit in development). It expires after 600 seconds and allows five attempts.
3. `POST /email-otp/reset-password` with `{ email, otp, password }`.
   The OTP is consumed atomically; a reused or invalid code returns `400` (`INVALID_OTP`). On success the password is replaced, existing sessions are revoked, and the email is marked verified.
4. `POST /sign-in/email` with the new password.

The reset-link endpoints (`/request-password-reset`, `/reset-password/:token`) are not wired to an email sender in this deployment; use the OTP flow instead. Verification, reset, sign-in, and email-change OTPs share the same branded HTML/text email template, with a purpose-specific subject and warning never to share the code.

#### OTP-only flow

1. `POST /email-otp/send-verification-otp` with `{ email, type: "sign-in" }`.
2. `POST /sign-in/email-otp` with `{ email, otp, name?, image? }`.
   If the email has no user, this endpoint creates a verified user when sign-up is enabled. `name` is used for a first-time user.

#### Google flow (optional)

Recommended for a frontend on a **different origin**: open a popup to the API's popup starter. The popup is first-party to `BETTER_AUTH_URL`, so Better Auth's state and opener-marker cookies are not third-party.

1. Generate a random nonce in the frontend and open:

```text
GET /api/auth/oauth-popup/start?provider=google
  &popupOrigin=<frontend-origin>
  &popupNonce=<random-nonce>
  &callbackURL=<frontend-url>
  &errorCallbackURL=<frontend-error-url>
```

`popupOrigin` must be listed in `CORS_ORIGIN` (or `BETTER_AUTH_URL`). The response is a `302` to Google.

2. The user completes Google. Google redirects to `GET/POST /callback/google?code=...&state=...`.
3. Better Auth renders a small completion page on the API origin. It posts one message to `window.opener`:

```json
{
  "type": "better-auth:oauth-popup",
  "targetOrigin": "http://localhost:5173",
  "nonce": "<same-nonce>",
  "token": "<session-token>",
  "redirectTo": "http://localhost:5173/..."
}
```

On failure, `token` is absent and `error: { code, description }` is present. The completion page has a strict CSP and does not expose the token in the URL.

4. The opener must check `event.origin` equals the API origin, check `data.type === "better-auth:oauth-popup"`, check `data.nonce`, store `data.token`, and close the popup. Then send `Authorization: Bearer <token>` on REST and `?token=<token>` on WebSockets.

This is the flow implemented in `pbp-client/pages/auth/login.js` and `pbp-client/assets/js/api.js` (localStorage key `ngumpul_bearer_token`). Allow popups for the frontend origin.

The API sends `Cross-Origin-Opener-Policy: unsafe-none` on `/api/auth/oauth-popup/*` and `/api/auth/callback/*`; otherwise Hono's default `same-origin` COOP would sever `window.opener` and the completion page could not post the token. All other API responses keep `same-origin`.

**Top-level fallback:** navigate the browser to:

```text
GET /api/auth/google/start?callbackURL=<frontend-url>&errorCallbackURL=<frontend-error-url>
```

The API validates both redirect URLs against the origins in `CORS_ORIGIN`/`BETTER_AUTH_URL`, stores the state cookie first-party, and responds with a `302` to Google. Invalid or missing callback parameters return `400 {"error":"Invalid callbackURL"}`; an upstream failure returns `502`; an unexpected failure returns `500`. This fallback fixes OAuth state but still sets the session cookie cross-site; if the browser blocks third-party cookies, use the popup/bearer flow.

`/sign-in/social` remains available for same-origin and native clients.

The Google OAuth redirect URI must be registered as:

```text
<BETTER_AUTH_URL>/api/auth/callback/google
```

Google is only enabled when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.

### 6.2 Endpoint details

#### `GET /ok`

Public. Confirms the auth handler is alive.

```json
{ "ok": true }
```

#### `POST /sign-up/email`

Body:

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `name` | string | yes | Display name |
| `email` | string | yes | Valid email; normalized lowercase |
| `password` | string | yes | Better Auth password constraints (minimum 8 by default) |
| `image` | string | no | URL |
| `callbackURL` | string | no | Post-verification redirect |
| `rememberMe` | boolean | no | Session length choice |

Response:

```json
{
  "token": null,
  "user": { "...": "User shape, emailVerified false" }
}
```

Duplicate emails get a deliberately generic response when verification is required.

#### `POST /sign-in/email`

Body:

```json
{ "email": "alice@example.test", "password": "Secret123!" }
```

Optional: `rememberMe` (default true), `callbackURL`.

On success, sets the session cookie and returns:

```json
{
  "token": "...",
  "user": { "...": "User shape" }
}
```

Unverified users are rejected until email verification is complete.

#### `POST /sign-in/email-otp`

Body:

```json
{ "email": "alice@example.test", "otp": "123456" }
```

Optional for a first-time user: `name`, `image`.

Returns a session token and user, and sets the cookie. Creates a verified user if one does not exist and sign-up is enabled.

#### `POST /email-otp/send-verification-otp`

Body:

```json
{ "email": "alice@example.test", "type": "email-verification" }
```

`type` is one of:

- `email-verification` — verify an email after sign-up
- `sign-in` — passwordless sign-in; can also provision a new user through `/sign-in/email-otp`
- `forget-password` — password reset
- `change-email` — deprecated here; use `/email-otp/request-email-change` instead

Response `200`:

```json
{ "success": true }
```

The response is intentionally generic for unknown emails. The OTP is 6 digits, expires in 600 seconds, allows 5 attempts, and is stored hashed.

#### `POST /email-otp/verify-email`

Body:

```json
{ "email": "alice@example.test", "otp": "123456" }
```

Response:

```json
{
  "status": true,
  "token": null,
  "user": { "...": "User shape, emailVerified true" }
}
```

`token` is non-null only if Better Auth's `autoSignInAfterVerification` is enabled (it is not in this configuration). This call does **not** create a session by default; follow with `/sign-in/email` or `/sign-in/email-otp`.

#### `POST /email-otp/check-verification-otp`

Body:

```json
{ "email": "alice@example.test", "type": "email-verification", "otp": "123456" }
```

Checks the OTP without consuming the verification. Returns `{ "success": true }`.

#### `POST /email-otp/request-password-reset`

Body:

```json
{ "email": "alice@example.test" }
```

Sends a `forget-password` OTP. Response `{ "success": true }` (generic).

#### `POST /email-otp/reset-password`

Body:

```json
{
  "email": "alice@example.test",
  "otp": "123456",
  "password": "NewSecret123!"
}
```

Response `{ "success": true }`.

#### `POST /email-otp/request-email-change`

Auth: required.

Body:

```json
{ "newEmail": "new@example.test" }
```

Sends an OTP to the new address.

#### `POST /email-otp/change-email`

Auth: required.

Body:

```json
{ "newEmail": "new@example.test", "otp": "123456" }
```

Completes the email change.

#### `POST /change-password`

Auth: required.

Body:

```json
{
  "currentPassword": "OldSecret123!",
  "newPassword": "NewSecret123!",
  "revokeOtherSessions": true
}
```

`revokeOtherSessions` is optional. Returns the user and may return a new session token when other sessions are revoked.

#### `POST /change-email`

Auth: required. Starts the non-OTP email-change flow.

```json
{ "newEmail": "new@example.test", "callbackURL": "http://localhost:5173/settings" }
```

Because a link-email sender is not configured in this deployment, prefer the OTP email-change endpoints.

#### `POST /update-user`

Auth: required.

```json
{ "name": "New Display Name", "image": "https://example.test/avatar.png" }
```

Only `name` and `image` are accepted here. Set `username` through `PUT /api/profile`.

#### `GET /get-session` (also `POST`)

Auth: cookie required to get a non-null result.

```json
{
  "session": {
    "id": "...",
    "token": "...",
    "userId": "...",
    "expiresAt": "...",
    "createdAt": "...",
    "updatedAt": "...",
    "ipAddress": "...",
    "userAgent": "..."
  },
  "user": { "...": "User shape" }
}
```

Without a valid session the response is `null`.

#### `POST /sign-out`

Auth: cookie. Clears the session cookie. Body is optional; `callbackURL` and `disableRedirect` are supported by Better Auth.

#### `GET /list-sessions`

Auth: required. Returns the caller's session records.

#### `POST /revoke-session`

Auth: required.

```json
{ "token": "session-token" }
```

#### `POST /revoke-sessions` / `POST /revoke-other-sessions`

Auth: required. No body.

#### `POST /delete-user`

Auth: required.

```json
{ "password": "Secret123!", "callbackURL": null }
```

Deletes the account. Database foreign keys cascade to sessions/accounts/profile and application-owned rows.

#### `POST /request-password-reset`

Auth: none.

```json
{ "email": "alice@example.test", "redirectTo": "http://localhost:5173/reset" }
```

This is the link-based flow. A reset-link email sender is not configured in this deployment; use `/email-otp/request-password-reset` instead.

#### `POST /reset-password`

Auth: none.

```json
{ "newPassword": "NewSecret123!", "token": "reset-token" }
```

The token may also be provided as the `token` query parameter.

#### `GET /verify-email`

Auth: none. Query: `token` (required), `callbackURL` (optional).

This is the link-based verification route. The primary application flow uses `/email-otp/verify-email`.

#### `POST /send-verification-email`

Auth: none.

```json
{ "email": "alice@example.test", "callbackURL": "http://localhost:5173/verified" }
```

Link-based resend. A verification-link sender is not configured in this deployment; use the email OTP endpoints.

#### `GET /account-info`

Auth: required. Returns account information for the current user.

#### `GET /list-accounts`

Auth: required. Returns linked provider accounts (`credential`, `google`, etc.).

#### `POST /link-social`

Auth: required.

```json
{ "provider": "google", "callbackURL": "http://localhost:5173/settings" }
```

#### `POST /unlink-account`

Auth: required. Takes the provider/account identifier according to Better Auth's schema.

#### `POST /refresh-token` / `POST /get-access-token`

Auth: required. Used for OAuth provider tokens; body identifies the provider/account. Not needed for normal cookie-session API use.

#### `POST /update-session`

Auth: required. Updates session metadata. Not normally needed by the frontend.

#### `GET /error`

Auth error page used by Better Auth redirects.

#### Deprecated: `POST /forget-password/email-otp`

Alias for `/email-otp/request-password-reset`; retained for compatibility.

---

## 7. WebSocket API

The app WebSocket server is attached to the same HTTP server as the REST API. It is **server-push only**: messages are sent through REST, and the socket delivers events.

### 7.1 Connection URLs

```text
ws://localhost:3000/ws/dm?peerId=<userId>
ws://localhost:3000/ws/channel?channelId=<channelId>
ws://localhost:3000/ws/user
```

- `peerId`: the other participant in a friend conversation.
- `channelId`: a server text channel. The server ID is inferred from the channel; do not send it.
- `/ws/user` is a per-user socket for server lifecycle events, notifications, and reactions. It needs no query parameter beyond the optional token.
- Voice channels are not valid for `/ws/channel`; use LiveKit for voice.

### 7.2 Authentication and Origin rules

Authentication uses the Better Auth session cookie or, for cross-site browser clients, `?token=<session-token>` appended to the WebSocket URL. Browsers send cookies automatically on the handshake; non-browser clients must send a `Cookie` header or token query parameter. Tokens in URLs can appear in browser history/proxy logs; this is a local fallback for clients that cannot set an `Authorization` header on a WebSocket handshake.

Origin handling:

- no `Origin` header: allowed (non-browser clients)
- `Origin` present: its origin must equal the origin of `CORS_ORIGIN` or `BETTER_AUTH_URL`
- mismatched browser Origin: rejected with HTTP `403` before the WebSocket upgrade

Handshake failures are plain HTTP responses, not WebSocket close frames:

| Status | Cause |
| --- | --- |
| `400` | missing `peerId`/`channelId` |
| `401` | no valid session |
| `403` | untrusted Origin, not a friend, blocked, not a server member, or channel not text |
| `404` | unknown WebSocket path |
| `500` | upgrade failure |

### 7.3 Access rules

`/ws/dm`:

- caller and `peerId` must be friends
- no block in either direction
- caller cannot use their own ID

`/ws/channel`:

- caller must be a member of the server that owns the channel
- channel must be `kind: "text"`

`/ws/user`:

- only requires a valid session
- receives events addressed to the caller by user ID; it does not grant access to any conversation or server by itself

Channel access is revalidated every 60 seconds. Sockets are also closed immediately when:

- a member is removed from the server
- the server is deleted
- the channel is deleted
- a friendship is removed
- a user is blocked

### 7.4 Connected event

Immediately after a successful upgrade:

DM:

```json
{ "type": "connected", "conversationWith": "user-b" }
```

Channel:

```json
{ "type": "connected", "channelId": "...", "serverId": "..." }
```

User:

```json
{ "type": "connected", "userId": "user-a" }
```

### 7.5 Events

#### Direct-message event envelope

```json
{
  "type": "direct_message",
  "event": "created",
  "senderId": "user-a",
  "recipientId": "user-b",
  "message": {
    "id": "...",
    "senderId": "user-a",
    "recipientId": "user-b",
    "text": "hello",
    "attachmentId": null,
    "replyToMessageId": null,
    "status": "sent",
    "deliveredAt": null,
    "readAt": null,
    "editedAt": null,
    "deletedAt": null,
    "createdAt": "...",
    "updatedAt": "...",
    "reactions": []
  }
}
```

`event` is `created`, `updated`, `deleted`, or `receipt`. Message objects include the same `reactions` summaries as REST.

- `created`: a new message was sent.
- `updated`: text or attachment reference changed.
- `deleted`: tombstone (text/attachment null, `deletedAt` set).
- `receipt`: status/delivery/read marker changed; `message` is the marker record.

A DM socket receives events for both directions of its conversation, including the caller's own events.

#### Channel-message event envelope

```json
{
  "type": "channel_message",
  "event": "created",
  "serverId": "...",
  "channelId": "...",
  "message": {
    "id": "...",
    "channelId": "...",
    "senderId": "user-a",
    "text": "hello channel",
    "attachmentId": null,
    "replyToMessageId": null,
    "editedAt": null,
    "deletedAt": null,
    "createdAt": "...",
    "updatedAt": "...",
    "reactions": []
  }
}
```

`event` is `created`, `updated`, or `deleted`. Message objects include `reactions`.

`updated` and `deleted` events do not include `replyTo`; clients should resolve the parent from their cache or REST list.

### 7.6 User event envelopes (`/ws/user`)

Every event is pushed only to the recipients listed by the server. A client can receive the same event type on multiple sockets; deduplicate by `type` plus `messageId`/`event` if needed.

Reaction added/removed:

```json
{
  "type": "message_reaction",
  "event": "added",
  "scope": "channel",
  "messageId": "...",
  "userId": "user-b",
  "emoji": "👍",
  "reactions": [{ "emoji": "👍", "count": 1, "userIds": ["user-b"] }],
  "serverId": "...",
  "channelId": "...",
  "createdAt": "..."
}
```

For DMs, `serverId`/`channelId` are replaced by `senderId`/`recipientId`. `reactions` never includes `me`; the processing client must derive it from `userId`.

Server lifecycle:

```json
{
  "type": "server_event",
  "event": "server.member_added",
  "serverId": "...",
  "actorId": "user-a",
  "server": { "...": "ServerSummary" },
  "member": { "userId": "user-b", "role": "member" },
  "createdAt": "..."
}
```

`event` is one of:

- `server.created`, `server.updated`, `server.deleted`
- `server.channel_created`, `server.channel_updated`, `server.channel_deleted`
- `server.member_added`, `server.member_updated`, `server.member_removed`
- `server.invite_created` (sent only to the creating user)

Optional fields: `server`, `channel`, `member`. The event is sent to current members; deletion events use the member list captured before deletion.

Notification:

```json
{
  "type": "notification",
  "notification": {
    "id": "...",
    "kind": "channel_message",
    "title": "Pesan baru",
    "body": "Alice: hello",
    "serverId": "...",
    "channelId": "...",
    "messageId": "...",
    "actorId": "user-a",
    "createdAt": "..."
  }
}
```

`kind` is `direct_message`, `channel_message`, `reaction`, `server_added`, or `member_joined`. Notifications are **ephemeral** (not stored in the database) and are currently delivered only while the user has a `/ws/user` socket open. Title/body are server-generated display strings, not a stable machine contract.

### 7.7 Client-to-server messages

The server does not accept application messages on these sockets. Any client message receives:

```json
{
  "type": "error",
  "error": "Send messages through the authenticated REST API"
}
```

The maximum client payload is 16 KiB.

### 7.8 Revocation close code

Access revocations use WebSocket close code **4003** with one of these reasons:

```text
You no longer have access to this server
This server was deleted
This channel was deleted
You no longer have access to this channel
You no longer have access to this conversation
```

A client should treat 4003 as terminal for that subscription and re-check authorization before reconnecting.

### 7.9 Reconnection and catch-up

There is no resume protocol and no event replay. On reconnect:

1. reopen the socket with a fresh session cookie
2. call the corresponding REST list endpoint (`GET /api/direct-messages/:peerId` or `GET /api/servers/:serverId/channels/:channelId/messages`) with `before` to fill any gap
3. then apply new WebSocket events

Use exponential backoff and stop retrying after an authentication/authorization failure until the session or membership changes.

---

## 8. LiveKit voice integration

LiveKit handles the actual audio/video media. The ngumpul backend only issues a signed JWT and tells the client which room to join.

### 8.1 Voice token endpoint

#### `POST /api/servers/:serverId/channels/:channelId/voice-token`

Auth: required.

Access:

- caller must be a member of `serverId`
- `channelId` must belong to `serverId`
- channel `kind` must be `voice`

No request body.

Response `200`:

```json
{
  "url": "ws://localhost:7880",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "room": "server-4571c0f6-624c-4e7c-8ea4-1fe3d76bd25f-channel-807d0138-5458-4d9b-bf97-7855ebbcc69b",
  "expiresInSeconds": 3600
}
```

Errors:

| Status | Cause |
| --- | --- |
| `401` | no session |
| `404` | not a server member, server/channel mismatch, or channel is not a voice channel |
| `503` | `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` not configured |

The token is a LiveKit access token with:

| Claim/grant | Value |
| --- | --- |
| `identity` / `sub` | caller's Better Auth user ID |
| `ttl` | 1 hour (`3600` seconds) |
| `roomJoin` | `true` |
| `room` | `server-<serverId>-channel-<channelId>` |
| `canPublish` | `true` |
| `canSubscribe` | `true` |
| `canPublishData` | `true` |

The room is created by LiveKit on first join; there is no separate create-room endpoint in ngumpul.

### 8.2 Client connection

Use a LiveKit client SDK, for example:

```ts
const res = await fetch(`/api/servers/${serverId}/channels/${channelId}/voice-token`, {
  method: "POST",
  credentials: "include",
});
const { url, token, room } = await res.json();

const roomHandle = new Room();
await roomHandle.connect(url, token);
```

The client must be able to reach:

- `url` over WebSocket (`ws://` locally, `wss://` in production)
- LiveKit's TCP media port (`7881` by default)
- LiveKit's UDP media range (`50000-50100` by default)

### 8.3 Server configuration

Development Compose values:

| Variable | Purpose |
| --- | --- |
| `LIVEKIT_API_KEY` | API key used by both the app and LiveKit |
| `LIVEKIT_API_SECRET` | API secret used by both the app and LiveKit |
| `LIVEKIT_PUBLIC_URL` | Signaling URL returned to clients, normally `ws://localhost:7880` locally or `wss://livekit.example.com` in production |
| `LIVEKIT_URL` | Reserved internal URL in Compose; the app currently returns `LIVEKIT_PUBLIC_URL` |

LiveKit server settings in `livekit.yaml`:

- signaling/HTTP port `7880`
- RTC TCP port `7881`
- UDP range `50000-50100`
- Redis at `redis:6379`
- API keys injected through the `LIVEKIT_KEYS` environment variable rather than committed to the YAML

Never expose `LIVEKIT_API_SECRET` to the browser. The client only receives the short-lived JWT.

### 8.4 What is not implemented

- no server-side recording
- no LiveKit webhook endpoint
- no room administration/list endpoint exposed by ngumpul
- no per-role voice permissions (all server members get publish/subscribe/data)
- no explicit room deletion; LiveKit empties/disposes rooms according to its own behavior

---

## 9. Permissions summary

### 9.1 Server actions

| Action | Owner | Admin | Member |
| --- | --- | --- | --- |
| View server/channels/members | yes | yes | yes |
| Update server metadata | yes | yes | no |
| Delete server | yes | no | no |
| Create/update/delete channel | yes | yes | no |
| Create invite | yes | yes | no |
| Join voice token | yes | yes | yes |
| Send channel message | yes | yes | yes |
| Edit own message | yes | yes | yes |
| Delete own message for everyone | yes | yes | yes |
| Delete someone else's message for everyone | yes | yes | no |
| Add member directly | yes | yes | no |
| Change member role | yes | no | no |
| Remove ordinary member | yes | yes | no |
| Remove admin | yes | no | no |
| Remove owner | no | no | no |
| Leave server | no (owner cannot leave) | yes | yes |

### 9.2 Message/DM actions

| Action | Who |
| --- | --- |
| DM list/send | friends with no block |
| DM edit | sender only |
| DM delete for me | either participant |
| DM delete for everyone | sender only |
| DM receipt | recipient of the marker |
| Channel list/send | current server members of a text channel |
| Channel edit | sender only |
| Channel delete for me | any current member |
| Channel delete for everyone | sender or server owner/admin |

---

## 10. Environment variables used by the API

| Variable | Required | Used for |
| --- | --- | --- |
| `PORT` | no (default `3000`) | HTTP server port |
| `BETTER_AUTH_URL` | yes | Better Auth base URL and trusted Origin; Google callback base |
| `BETTER_AUTH_SECRET` | yes | Auth signing/encryption; at least 32 characters |
| `CORS_ORIGIN` | recommended | Frontend origin for CORS, Better Auth trusted origin, WebSocket Origin allowlist |
| `DATABASE_URL` | yes | PostgreSQL connection |
| `REDIS_URL` | no (default `redis://localhost:6379`) | Realtime pub/sub |
| `SMTP_HOST`, `SMTP_PORT` | yes for email | OTP delivery |
| `SMTP_HOST_DOCKER`, `SMTP_PORT_DOCKER` | yes for email in Compose | Container overrides for the SMTP host/port; must point at the real provider, not Mailpit, in production |
| `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | no | SMTP auth/TLS; `SMTP_SECURE=true` for implicit TLS on port 465 |
| `EMAIL_FROM` | no | From address for OTP mail |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no | Enable Google OAuth when both set |
| `LIVEKIT_PUBLIC_URL` | yes for voice | Signaling URL returned to clients |
| `LIVEKIT_API_KEY` | yes for voice | LiveKit JWT key |
| `LIVEKIT_API_SECRET` | yes for voice | LiveKit JWT secret; never expose |
| `S3_BUCKET` | yes for attachments | Bucket name |
| `S3_REGION` | no (default `us-east-1`) | S3 region |
| `S3_ENDPOINT` | no for AWS, yes for MinIO | Internal S3 endpoint |
| `S3_PUBLIC_ENDPOINT` | no | Endpoint used in presigned upload/download URLs |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | no for IAM roles | S3 credentials |
| `S3_AUTO_CREATE_BUCKET` | no | Create the bucket at startup in development |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`, `REDIS_PORT` | Compose only | Local infrastructure |

`BETTER_AUTH_SECRET` and `LIVEKIT_API_SECRET` must be distinct random values. Do not commit `.env`.

---

## 11. Minimal end-to-end data flow

### 11.1 New account and profile

```text
POST /api/auth/sign-up/email                    { name, email, password }
POST /api/auth/email-otp/send-verification-otp  { email, type: "email-verification" }
POST /api/auth/email-otp/verify-email           { email, otp }
POST /api/auth/sign-in/email                    { email, password }  -> session cookie
PUT  /api/profile                               { username, displayName, ... }
GET  /api/me                                    -> user with username
```

### 11.2 Friend and DM

```text
POST /api/friends/requests               { username: "bob" }
POST /api/friends/requests/:id/accept    (Bob)
GET  /api/friends
POST /api/direct-messages/:peerId        { text: "hello" }
WS   /ws/dm?peerId=:peerId               -> connected + direct_message events
```

### 11.3 Server, channels, and messages

```text
POST /api/servers                                  { name, description? }
GET  /api/servers/:serverId/channels               -> general channel
POST /api/servers/:serverId/invites                { expiresInSeconds?, maxUses? }
POST /api/servers/invites/:code/join               (Bob)
GET  /api/servers/:serverId/members
POST /api/servers/:serverId/channels               { name, kind }
POST /api/servers/:serverId/channels/:channelId/messages  { text }
WS   /ws/channel?channelId=:channelId              -> connected + channel_message events
```

### 11.4 Attachment

```text
POST /api/attachments/uploads                 { targetType, targetId, fileName, mimeType, sizeBytes }
POST <upload.url>                             multipart: upload.fields + file
POST /api/attachments/:id/complete            -> attachment + previewUrl
POST /api/direct-messages/:peerId             { attachmentId }
# or
POST /api/servers/:serverId/channels/:channelId/messages  { attachmentId }
GET  /api/attachments/:id/download-url        -> authenticated temporary URL
GET  /api/attachments/:id/preview             -> public 302 inline preview
```

### 11.5 Voice

```text
POST /api/servers/:serverId/channels/:voiceChannelId/voice-token
  -> { url, token, room, expiresInSeconds }
LiveKit client: room.connect(url, token)
```
