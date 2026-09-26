# Backend bugs

Scope: `backend/` on `main`. Written at 029e2de and rechecked at 371e3d2, which the line numbers refer to; items fixed since then are removed. I found these by reading the code; none were reproduced. Ordered by severity.

## High

### 1. Auth rate limits are shared by every user behind the proxy

`backend/api/src/middleware/rateLimit.middleware.ts:19`

The auth limiters key on `getConnInfo(c).remote.address`, the TCP peer. Railway puts its edge proxy in front of the service, so that peer is the proxy for every request, and all users land in one bucket. The budgets are per 15 minutes: `/auth/me` 200, `/auth/login` 60, `/auth/callback` 20, `/auth/logout` 60. The client calls `/auth/me` on load (`client/src/config.ts:14`). About 200 page loads across the whole user base in 15 minutes would 429 everyone, and 20 logins would block the callback for everyone.

Check: log `remote.address` in production. If it is one address, key on the client IP the proxy forwards (`X-Forwarded-For` / `X-Real-IP`).

## Medium

### 2. Logging out does not end the session token

`backend/api/src/auth/sessionToken.ts:29`, `backend/api/src/controllers/auth.controller.ts:27`

The session cookie is an HS256 JWT valid for 7 days. `verifySessionToken` checks only the signature, `exp` and claim types. Logout clears the cookie and revokes the WorkOS session, but nothing on the API side checks that session again. A copied cookie keeps working for the rest of its 7 days after logout, both for HTTP and for the Socket.IO handshake.

### 3. An image can be 50 MB until the confirm step rejects it

`backend/shared/storage/schema.ts:89`, `backend/shared/sweeper.ts:12`

The bucket refuses any upload over 50 MB, or of a type other than `image/*` or `audio/*` (`BUCKET_SETTINGS`, applied with `npm run storage:push`). One bucket holds both kinds, so its size limit is audio's: an image can land at up to 50 MB when images stop at 10 MB. The confirm step rejects it, and it stays in the bucket until the sweep, which runs hourly for anything older than 3 hours. With 30 upload URLs per user per 15 minutes, one account could keep about 1.5 GB parked there. Separate image and audio buckets would give each kind its own limit.

### 4. The number of transcript attachments is still unlimited

`backend/api/src/schema/messages.schema.ts:75`

`MAX_ATTACHMENTS` counts only images, as PROBLEMS2.md already notes. Thousands of `audioUploadId`s go into `claimAttachments`, `findTranscripts` and `findCreateMessageHistory` as `IN` lists before the character budget rejects the request.

## Low

### 5. A lost `transcribe_done` leaves the user's screen out of date

`backend/transcribe-worker/transcribeJob.ts:158`

If publishing `transcribe_done` fails after the transcript is saved, `announceCompletion` logs it and the message is done; nothing publishes it again. While its socket stays connected, the client only refetches a job when it receives that event, so the source keeps showing "transcribing" until a reload or a socket reconnect. A lost publish without the connection dropping (which exits the process) should be rare.
