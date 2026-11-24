# Backend Task List

## Product decisions

- Phone-number sign-in and phone-number contact discovery are removed from scope.
- The relationship list is a **friends list**. Users find one another by unique username and send/accept friend requests; the backend does not import or sync device contacts.
- Group chats are modeled as Discord-style **servers** containing text and voice channels. Voice media uses LiveKit; the API issues short-lived, room-scoped tokens only to server members.
- User-facing features are tracked here, with backend work prioritized before frontend polish.

## Foundation already present

- [x] Email/password auth and Better Auth route mount.
- [x] Google OAuth provider configuration (Google credentials still need to be supplied in `.env`).
- [x] PostgreSQL/Drizzle, Redis, and LiveKit services in Docker Compose.
- [x] Authenticated WebSocket endpoints for private direct messages, server text channels, and per-user realtime events, backed by Redis Pub/Sub.

## First backend tranche

- [x] Normalize and enforce case-insensitive unique usernames; support profile create/update and username search.
- [x] Friend requests: send by username, list incoming/outgoing, accept/decline, list friends, cancel, and remove friend.
- [x] Server foundation: create/list servers, join with single/multi-use expiring invites, and create/list text/voice channels with owner/admin checks.
- [x] LiveKit voice-channel tokens: require server membership and issue room-scoped, expiring credentials.
- [x] S3-compatible attachment storage: private bucket, signed bounded uploads, attachment metadata, immutable final objects, and access-checked temporary download URLs.
- [x] Persist direct messages, enforce friend/block access, and publish private direct-message events through Redis-backed WebSockets.
- [x] Persist server-channel messages and bind access to channel membership.
- [x] Edit/delete server and channel metadata; manage member roles and removal.
- [x] Publish server/member/channel lifecycle events, message reactions, and new-message notifications to a per-user WebSocket (`/ws/user`).
- [ ] Connect a voice client to LiveKit and implement speaking/mute/leave flows in the application client.

## Feature backlog

### Accounts and profile

- [x] Edit profile display name, avatar URL, and description.
- [x] Verify accounts with an email OTP; Better Auth blocks password and Google OAuth sessions until the address is verified.
- [x] Change password with current-password verification and Better Auth password validation.
- [x] Reset a forgotten password with a six-digit email OTP; the OTP is single-use, expires in ten minutes, and is rate-limited.
- [x] Block and unblock users; remove friendship/pending requests and prevent new friend requests while blocked.
- [x] Configure photo, online-status, and last-seen visibility (`everyone`, `friends`, `nobody`); enforce photo visibility in username search.
- [x] Report users with a reason and optional details.
- [x] Add friends by unique username; no phone-number or device-contact discovery.
- [ ] Add friends by QR code.

### Direct messages

- [x] Send and page through persistent text messages in friend conversations.
- [x] Track sent, delivered, and read states with recipient receipts.
- [x] Send images through the S3 attachment flow and link files to messages.
- [x] Reply to a message with a quoted message preview.
- [ ] Forward messages to a friend or server channel.
- [x] Delete a message for self or everyone.
- [x] Edit a message and mark it edited.
- [x] Add emoji reactions to direct and channel messages with per-user toggle, REST endpoints, and realtime `message_reaction` events.
- [ ] Search messages.
- [ ] Pin messages.
- [ ] Save unsent drafts.
- [ ] Encrypt message content.
- [ ] Show online and last-seen status.
- [ ] Enforce online-status and last-seen visibility when presence is implemented.
- [ ] Show typing indicators.
- [ ] Send and play voice messages, including pause and seek.
- [x] Browse conversation media and attachment metadata.
- [ ] Share a location.
- [ ] Back up and restore chat history.
- [ ] Schedule messages.
- [ ] Support disappearing messages.
- [ ] Archive conversations.
- [ ] Favorite chats.
- [ ] Mark chats/messages unread.
- [ ] Mute notifications per friend.
- [ ] Translate messages automatically.
- [ ] Sort and filter the chat list.

### Servers and channels (replaces group chat)

- [x] Create servers, invite/join by code, and create/list text or voice channels.
- [x] Add/remove server members outside the invite flow.
- [x] Edit server name, icon, and description; delete servers and channels.
- [x] Manage server admin roles and permissions (`owner`, `admin`, `member`).
- [x] Persist text-channel messages with edits, per-user or global deletes, reply references, and attachments.
- [ ] Mention members with `@`.
- [ ] Create polls and show vote results.
- [ ] Send server announcements.
- [ ] Support voice and video calls/streams in voice channels (voice token endpoint is ready; client join/stream controls remain).
- [x] Add server invites with expiry and usage limits.

### Media, notifications, and appearance

- [ ] Send images, videos, voice messages, and documents as persistent chat messages (attachment storage API is ready; message persistence/linking remains).
- [x] Notify users about new messages, reactions, and server/member events through ephemeral realtime notifications on `/ws/user`; notifications are not persisted or listed later.
- [ ] Customize chat wallpaper, bubble colors, and text size.
- [ ] Configure notification settings per friend/channel.
- [ ] Add dark and light theme preferences (persist preference only if a server-side profile setting is needed).

## Notes

- Every completed item should be checked only after its API/data path exists and has been verified.
- Security-sensitive media access must use short-lived signed URLs/tokens; never expose provider secrets to clients.
- First-tranche smoke flow passed: profile setup, username search, friend request/accept, server creation, invite join, voice channel creation, and member voice-token issuance.
- Attachment smoke flow passed: a friend-scoped text attachment was uploaded to the private S3-compatible bucket, finalized to an immutable object key, listed by the recipient, and downloaded through a temporary URL.
- Account/profile smoke flow passed: password change rejected the wrong current password and accepted the correct one, photo visibility settings were persisted, blocked users disappeared from search and could not send friend requests, and a report was created.
- Email OTP flow is captured locally by Mailpit in Compose; production must supply a real SMTP provider. OTPs expire after 10 minutes, allow five verification attempts, and are stored hashed.
- Direct-message smoke flow passed: persisted text, authenticated Redis/WebSocket delivery, reply preview, edit, delivered/read receipt, per-user and global deletion, cursor pagination, and S3 image upload/link/download/deletion.
- Local Compose uses Silo (MinIO-compatible S3 API) with auto-created private bucket `pbp-attachments`; configure S3 environment variables to use another S3 provider.
- Server/channel smoke flow passed: server and channel metadata updates, member add/list/promote/remove, owner protections, channel message send/list/edit/delete with attachment linking, and authenticated channel WebSocket delivery.
- Realtime/reaction smoke flow passed: `/ws/user` delivered `server.created`/`server.channel_created`/`server.updated`, `message_reaction` for DM and channel messages, and notification events; REST reaction add/remove was idempotent and returned summaries with `me`; reaction summaries appeared in message lists; public `wss://api.afadhili.my.id/ws/user` worked with a bearer token.
- Security hardening: authenticated WebSockets with Origin checks, socket revocation on member removal/block, explicit Better Auth rate limits, 1 MiB JSON body cap, security headers, HTTP timeouts, server-side attachment magic-byte validation, distinct rotated auth/LiveKit secrets supplied through `.env`, and loopback-only PostgreSQL/Redis/object-store ports.
- Attachment preview smoke flow passed: a ready PNG rendered through the unauthenticated public `/api/attachments/:attachmentId/preview` capability URL (302 to an inline signed object URL, correct bytes), while `/download-url` still required a session; test metadata and objects were removed afterward.

## First-tranche API

- `GET/PUT /api/profile`: read or update username, display name, bio, avatar URL, and profile visibility.
- `GET /api/users/search?username=...`: authenticated prefix search; username is canonical lowercase and unique without case sensitivity.
- `GET /api/friends`, `GET /api/friends/requests`, and `POST /api/friends/requests`: friends and username-based requests.
- `POST /api/friends/requests/:requestId/accept`, `/decline`, or `/cancel`, plus `DELETE /api/friends/:userId`: request and friendship lifecycle.
- `GET/POST /api/servers`: list or create servers; creators become owners and get a `general` text channel.
- `POST /api/servers/:serverId/invites` and `POST /api/servers/invites/:code/join`: create and redeem expiring/limited-use invitations.
- `PATCH/DELETE /api/servers/:serverId`: edit server name/description/icon (owner/admin) or delete the server (owner only).
- `GET/POST /api/servers/:serverId/channels`: list or create `text` and `voice` channels; only owners/admins can create channels.
- `PATCH/DELETE /api/servers/:serverId/channels/:channelId`: rename/reorder a channel or delete it (owner/admin). Channel `kind` is immutable.
- `GET/POST /api/servers/:serverId/members`: list members or add one by `{ "username": "..." }` or `{ "userId": "..." }` (owner/admin).
- `PATCH/DELETE /api/servers/:serverId/members/:userId`: owner changes a member role (`admin` or `member`); members may leave, and owners/admins may remove members, with owner/admin protections.
- `POST /api/servers/:serverId/channels/:channelId/voice-token`: issue a one-hour LiveKit token to a server member for that voice channel.
- `GET/POST /api/servers/:serverId/channels/:channelId/messages`: list or send text-channel messages. Listing supports `limit` (1–100) and `before` (message ID) cursor pagination and returns `nextCursor`. Sending accepts `text`, `attachmentId`, and `replyToMessageId`.
- `PATCH/DELETE /api/servers/:serverId/channels/:channelId/messages/:messageId`: edit the sender's message, or delete it for the sender only (`scope=me`) or everyone (`scope=everyone`; sender or owner/admin). Attachment-only messages are supported.
- `POST /api/attachments/uploads`: create attachment metadata and return a short-lived signed S3 POST form. JSON fields: `targetType` (`direct` or `channel`), `targetId`, `fileName`, `mimeType`, `sizeBytes`. Upload the file to the returned `upload.url` as multipart form data with every returned `upload.fields` value and a `file` field.
- `POST /api/attachments/:attachmentId/complete`: owner verifies and finalizes the staged upload. Final object keys cannot be overwritten by the upload form.
- `GET /api/attachments?targetType=...&targetId=...`: list ready attachment metadata after access checks.
- `GET /api/attachments/:attachmentId/download-url`: get a five-minute download URL after access checks. `GET /api/attachments/:attachmentId/preview`: public, no-session capability URL that redirects to a short-lived inline object URL; attachment responses include it as `previewUrl`. Anyone with the preview URL can view the file. `DELETE /api/attachments/:attachmentId`: uploader removes the metadata and object.
- Allowed attachment types and per-type limits are enforced by the backend; signed POST policies also cap upload size. Storage bucket stays private; the API mediates metadata, finalization, and authenticated download authorization, with the public capability preview route as the explicit exception.
- Better Auth password change: `POST /api/auth/change-password` with `{ "currentPassword": "...", "newPassword": "...", "revokeOtherSessions": true }`.
- Email verification: signup sends an OTP to the email. `POST /api/auth/email-otp/verify-email` accepts `{ "email": "...", "otp": "..." }`; request a replacement with `POST /api/auth/email-otp/send-verification-otp` and `{ "email": "...", "type": "email-verification" }`. The OTP is only delivered by email and is never returned by the API.
- Password reset: `POST /api/auth/email-otp/request-password-reset` with `{ "email": "..." }` sends a `forget-password` OTP; complete it with `POST /api/auth/email-otp/reset-password` and `{ "email": "...", "otp": "...", "password": "..." }`. The request response is generic, the code is single-use and expires in ten minutes, reset requests are limited to three per minute, and existing sessions are revoked on success.
- `POST /api/users/:userId/block`, `DELETE /api/users/:userId/block`, and `GET /api/blocks`: block lifecycle. Blocking removes an existing friendship and pending requests; requests and username search honor blocks in either direction.
- `POST /api/users/:userId/reports` with `{ "reason": "spam|harassment|impersonation|inappropriate_content|other", "details": "optional" }`: submit a user report. Duplicate reports from one reporter for one account are rejected.
- `GET/PUT /api/privacy`: read or update `photoVisibility`, `onlineStatusVisibility`, and `lastSeenVisibility` using `everyone`, `friends`, or `nobody`. Search results enforce photo visibility; presence enforcement awaits the presence feature.
- `GET/POST /api/direct-messages/:peerId`: list a friend's messages or send text and/or a ready attachment ID. Listing supports `limit` (1–100) and `before` (message ID) cursor pagination. Replies can include `replyToMessageId`.
- `PATCH /api/direct-messages/:messageId`: edit the sender's message text. `DELETE /api/direct-messages/:messageId?scope=me|everyone`: hide it for the signed-in user or delete it for both participants (sender only); `scope` is required.
- `POST /api/direct-messages/:messageId/receipts` with `{ "status": "delivered|read" }`: acknowledge the received message and all earlier incoming messages in that conversation.
- `POST /api/direct-messages/:messageId/reactions` with `{ "emoji": "👍" }` and `DELETE /api/direct-messages/:messageId/reactions/:emoji`: add/remove an emoji reaction; responses return `{ messageId, reactions }`.
- `POST /api/servers/:serverId/channels/:channelId/messages/:messageId/reactions` with `{ "emoji": "👍" }` and `DELETE .../reactions/:emoji`: add/remove a channel-message reaction with the same summary shape.
- `WS /ws/dm?peerId=...`: authenticated private realtime stream for two friends; it relays message, edit, delete, and receipt events. Send messages through the authenticated REST API.
- `WS /ws/channel?channelId=...`: authenticated realtime stream for a server text channel, available only to current server members. It emits `connected`, `channel_message` created/updated/deleted events, and closes with code `4003` when access is revoked. Browser Origins must match `CORS_ORIGIN`/`BETTER_AUTH_URL`.
- `WS /ws/user`: authenticated per-user stream for `server_event`, `notification`, and `message_reaction` events. It does not grant any conversation access by itself; sockets use the session cookie or `?token=<session-token>`.
