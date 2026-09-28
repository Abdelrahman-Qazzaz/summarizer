# Backend bugs

Scope: `backend/` on `main`. Written at 029e2de and rechecked at 371e3d2, which the line numbers refer to; items fixed since then are removed. I found these by reading the code; none were reproduced. Ordered by severity.

## Medium

### 1. Logging out does not end the session token

`backend/api/src/auth/sessionToken.ts:29`, `backend/api/src/controllers/auth.controller.ts:27`

The session cookie is an HS256 JWT valid for 7 days. `verifySessionToken` checks only the signature, `exp` and claim types. Logout clears the cookie and revokes the WorkOS session, but nothing on the API side checks that session again. A copied cookie keeps working for the rest of its 7 days after logout, both for HTTP and for the Socket.IO handshake.

## Low

### 2. A lost `transcribe_done` leaves the user's screen out of date

`backend/transcribe-worker/transcribeJob.ts:158`

If publishing `transcribe_done` fails after the transcript is saved, `announceCompletion` logs it and the message is done; nothing publishes it again. While its socket stays connected, the client only refetches a job when it receives that event, so the source keeps showing "transcribing" until a reload or a socket reconnect. A lost publish without the connection dropping (which exits the process) should be rare.
