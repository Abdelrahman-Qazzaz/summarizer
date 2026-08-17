### Still present

- High — Chat retries can duplicate AI calls and messages.
  A disconnected request continues running. Retrying starts another model run because there is no request/idempotency key.
  backend/api/src/controllers/messages.controller.ts:222-225,304-360

- High — Rerun can become permanently queued.
  It changes the DB to queued, deletes the transcript, then publishes. If deletion or publishing fails, retrying returns 409 because the job is already queued—so the endpoint cannot
  recover it.
  backend/api/src/controllers/jobs.controller.ts:110-120

- High — Upload retries create duplicate jobs.
  Audio, YouTube, and image requests generate a fresh UUID each time. A lost response followed by retry creates another upload/job and potentially another paid transcription.
  backend/api/src/controllers/upload.controller.ts:17-30,47-64

- Medium — Stale YouTube failure events can overwrite newer state.
  failAudioJobById() unconditionally sets failed; it has no status or claim guard.
  backend/shared/data/jobs.data.ts:180-188

- Medium — Handler exceptions discard messages.
  Errors use nack(..., false, false), while the declared retry/DLX exchanges are not actually wired. A transient DB failure can leave a queued job with no message.
  backend/shared/message-queue/messageQueue.consumer.ts:22-30
  backend/shared/message-queue/messageQueue.topology.ts:18-24

- Medium — Deletes can orphan bucket objects.
  Message/conversation DB rows are deleted before bucket cleanup. If cleanup fails, retry returns 404 because the IDs needed for cleanup are gone.
  backend/api/src/controllers/messages.controller.ts:365-381
  backend/api/src/controllers/conversations.controller.ts:65-82

- Low — Conversation creation is retry-duplicable.
  Each repeated POST inserts another conversation.

The publisher-confirm commit improves confirmation isolation, but it does not make DB + bucket + RabbitMQ operations atomic. I inspected only commit
a8274bddffd84873ba925dceec571c201b1fc22f; the active worktree was untouched.
