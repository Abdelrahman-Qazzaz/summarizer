# Backend bugs

Scope: `backend/` on `main` at 029e2de. I found these by reading the code; none were reproduced. Ordered by severity.

## High

### 1. Auth rate limits are shared by every user behind the proxy

`backend/api/src/middleware/rateLimit.middleware.ts:19`

The auth limiters key on `getConnInfo(c).remote.address`, the TCP peer. Railway puts its edge proxy in front of the service, so that peer is the proxy for every request, and all users land in one bucket. The budgets are per 15 minutes: `/auth/me` 200, `/auth/login` 60, `/auth/callback` 20, `/auth/logout` 60. The client calls `/auth/me` on load (`client/src/config.ts:14`). About 200 page loads across the whole user base in 15 minutes would 429 everyone, and 20 logins would block the callback for everyone.

Check: log `remote.address` in production. If it is one address, key on the client IP the proxy forwards (`X-Forwarded-For` / `X-Real-IP`).

### 2. A dropped delivery leaves a job stuck with nothing to notice it

`backend/shared/message-queue/messageQueue.consumer.ts:27`, `backend/shared/message-queue/messageQueue.topology.ts:18`

Any handler that throws gets `nack(message, false, false)`. The `retry` and `dead_letter` exchanges are declared but no queue routes to them, so the message is deleted. Where a handler throws before the job reaches a terminal status, the job stays unfinished for good:

- Worker: `claimAudioJob` throws (for example, a database blip) before the claim. The job stays `queued`.
- Worker: the job is claimed and fails, then `failAudioJob` also throws in the catch (`transcribe-worker/transcribeJob.ts:116`). The job stays `processing`.
- API: the `YT_FETCH_FAILED` handler's `failAudioJobById` throws (`api/index.ts:35`). The job stays `queued`, and the user's socket never gets `jobUpdated`.

This has the same symptom as the deferred "queue publish gap", but a different cause: that one is a message never published, this one is a message delivered and then discarded. The "republish jobs queued too long" pass agreed for that gap would not catch jobs stuck in `processing`.

### 3. RabbitMQ connection loss is not handled

`backend/shared/message-queue/messageQueue.ts:407`

Nothing listens for `error` or `close` on the connection or either channel, and nothing reconnects. `messageQueuePromise` caches the first connection forever. When the broker restarts or the network drops, one of two things happens:

- The `error` event has no listener, so Node throws and the process exits. The restart policy then recovers it.
- The connection closes without `error`. The process keeps running on a dead channel: every `publish` fails, which makes every audio confirm and YouTube upload fail its job through `publishOrFail`, and the consumers never receive again. The worker stays alive on the sweeper's `setInterval`, so a restart-on-crash policy never fires.

A channel-level error, such as acking on a channel that has already closed, has the same missing-listener problem.

## Medium

### 4. Logging out does not end the session token

`backend/api/src/auth/sessionToken.ts:29`, `backend/api/src/controllers/auth.controller.ts:27`

The session cookie is an HS256 JWT valid for 7 days. `verifySessionToken` checks only the signature, `exp` and claim types. Logout clears the cookie and revokes the WorkOS session, but nothing on the API side checks that session again. A copied cookie keeps working for the rest of its 7 days after logout, both for HTTP and for the Socket.IO handshake.

### 5. `failAudioJobById` can mark a completed job failed

`backend/shared/data/jobs.data.ts:282`

The update has no status condition. A late `YT_FETCH_FAILED` sets `status = 'failed'` on a job that has already completed, and the transcript row stays. One way this happens: the fetcher publishes `transcribe` but dies before acking `yt_fetch`, then the redelivered fetch fails. After that, the job view shows `failed` with a transcript, and `deleteAudioJob` treats the job as terminal. Restricting the update to `queued`/`processing` would close it.

### 6. Upload size is checked only after the bytes land

`backend/shared/storage/bucket.ts:445`, `backend/shared/sweeper.ts:15`

`createSignedUploadUrl` puts no size or type limit on the URL. The 100 MB audio and 10 MB image caps are checked at confirm time, and a rejected object stays in the bucket until the sweep, which runs hourly for anything older than 3 hours. With 30 upload URLs per user per 15 minutes, one account can keep a lot of storage filled. The only hard cap is a bucket-level `file_size_limit` in Supabase, and nothing in the repo sets or checks one.

### 7. The number of transcript attachments is still unlimited

`backend/api/src/schema/messages.schema.ts:151`

`MAX_ATTACHMENTS` counts only images, as PROBLEMS2.md already notes. Thousands of `audioUploadId`s go into `claimAttachments`, `findTranscripts` and `findCreateMessageHistory` as `IN` lists before the character budget rejects the request.

## Low

### 8. Worker failures record no reason

`backend/shared/data/jobs.data.ts:412`

`failAudioJob` sets `status` but not `error`, so a Deepgram failure or an empty transcript shows up as `failed` with `error: null`. The API-side failure paths do write a message.

### 9. A lost `transcribe_done` publish is logged as a failed transcription

`backend/transcribe-worker/transcribeJob.ts:110`

If the publish after `saveCompletedTranscript` throws, the catch logs "Transcription job failed" and nacks, even though the job is already `completed`. `failAudioJob` correctly does nothing. The user's socket never hears about the job, so the UI waits until something refetches it.
