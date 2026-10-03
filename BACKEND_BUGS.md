# Backend bugs

Scope: `backend/` on `main`. Written at 029e2de and rechecked at e8040ee, which the line numbers refer to; items fixed since then are removed. I found these by reading the code; none were reproduced. Ordered by severity.

## Medium

### 1. Unconfirmed uploads can hold storage for hours

`backend/shared/uploads.ts:20`, `backend/shared/sweeper.ts:12`, `backend/api/src/middleware/rateLimit.middleware.ts:125`

Each upload URL records a pending object, and storage accepts one file on it: up to 50 MB of audio or 10 MB of image. An upload that is never confirmed stays until the sweep, which runs hourly and removes pending objects older than 3 hours, so each one lives 3 to 4 hours. Minting is limited to 30 URLs per user per 15 minutes, so in the 3 hours before its first uploads are swept one account can mint 360 URLs and park up to 18 GB of audio. The per-kind buckets cap how large each file can be, not how many are left unconfirmed, and nothing caps a user's pending uploads.

## Low

### 2. A lost `transcribe_done` leaves the user's screen out of date

`backend/transcribe-worker/transcribeJob.ts:158`

If publishing `transcribe_done` fails after the transcript is saved, `announceCompletion` logs it and the message is done; nothing publishes it again. While its socket stays connected, the client only refetches a job when it receives that event, so the source keeps showing "transcribing" until a reload or a socket reconnect. A lost publish without the connection dropping (which exits the process) should be rare.

### 3. A job whose process dies before publishing stays queued

`backend/shared/audioTranscription.ts:32`, `backend/api/src/controllers/upload.controller.ts:114`

A job's row is committed before its work is published to the queue. `publishOrFail` fails the job when the broker refuses the publish, but a process that dies between the commit and the publish leaves the job `queued` with no worker or fetcher coming for it, and nothing notices. A pass that republishes jobs left `queued` too long would recover them; it needs a threshold per source, since a YouTube job is legitimately `queued` for the whole download.
