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

### 3. Upload size is checked only after the bytes land

`backend/shared/storage/bucket.ts:31`, `backend/shared/sweeper.ts:12`

`createSignedUploadUrl` puts no size or type limit on the URL. The 100 MB audio and 10 MB image caps are checked at confirm time, and a rejected object stays in the bucket until the sweep, which runs hourly for anything older than 3 hours. With 30 upload URLs per user per 15 minutes, one account can keep a lot of storage filled. The only hard cap is a bucket-level `file_size_limit` in Supabase, and nothing in the repo sets or checks one.

### 4. The number of transcript attachments is still unlimited

`backend/api/src/schema/messages.schema.ts:75`

`MAX_ATTACHMENTS` counts only images, as PROBLEMS2.md already notes. Thousands of `audioUploadId`s go into `claimAttachments`, `findTranscripts` and `findCreateMessageHistory` as `IN` lists before the character budget rejects the request.

## Low

### 5. Worker failures record no reason

`backend/shared/data/jobs.data.ts:357`

`failAudioJob` sets `status` but not `error`, so a Deepgram failure or an empty transcript shows up as `failed` with `error: null`. The API-side failure paths do write a message.

### 6. A lost `transcribe_done` publish is logged as a failed transcription

`backend/transcribe-worker/transcribeJob.ts:112`

If the publish after `saveCompletedTranscript` throws, the catch logs "Transcription job failed", even though the job is already `completed`. `settleFailedJob` then finds no claim to hand back, or no job to fail, so the message is acked and nothing retries the publish. The user's socket never hears about the job, so the UI waits until something refetches it.
