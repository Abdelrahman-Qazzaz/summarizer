# Backend architecture

A modular monolith. Everything under `backend/` is a
single npm package (`summarizer-server`) built from one codebase and one
`shared/` module. It runs as multiple process types that talk through a
RabbitMQ message queue and a shared Postgres database:

- `api` — the HTTP + WebSocket service clients talk to.
- `transcribe-worker` — the background queue worker that runs transcription.

They are the same artifact started at different entrypoints, not independently
deployable services. See [Why it isn't microservices](#why-it-isnt-microservices).

## External dependencies

Each process runs a **fail-fast preflight** on boot (`startup.ts` →
`verifyServices`): if any dependency it needs is down, it aborts instead of
starting half-alive.

## Message queues

Defined in `shared/message-queue/messageQueue.ts`:

| Queue                | Producer → Consumer    | Payload                                                                   |
| -------------------- | ---------------------- | ------------------------------------------------------------------------- |
| `transcribe`         | api / fetcher → worker | `{ audioUploadId }`                                                       |
| `caption_transcript` | fetcher → worker       | `{ audioUploadId }`                                                       |
| `transcribe_done`    | worker → api           | `{ audioUploadId, userId }`                                               |
| `yt_fetch`           | api → youtube-fetcher  | `{ audioUploadId, captionUploadId, url, userId, useCaptionsIfAvailable }` |
| `yt_fetch_failed`    | youtube-fetcher → api  | `{ audioUploadId, userId, error? }`                                       |

The channel uses `prefetch(1)` **per consumer**, so a single worker process
handles at most one transcribe job at a time. Handlers are `await`ed before
`ack`; a thrown handler `nack`s (no requeue).

## End-to-end flow (audio upload)

```
  browser
    │  upload audio
    ▼
  ┌──────┐  create AudioTranscriptionJobs (queued)      ┌───────────────────┐
  │ api  │ ───────────── transcribe ───────────────────▶│ transcribe worker │
  └──────┘                                              └───────────────────┘
    ▲                                                     │ claim job, sign audio URL,
    │                                                     │ call Deepgram, save transcript
    │◀───────────── transcribe_done ──────────────────────┤ and complete job in Postgres
    └── Socket.IO: jobUpdated to the user's room ──▶ browser
```

A YouTube upload takes the same path one step earlier: the API publishes
`yt_fetch`. When captions are preferred, the API reserves and persists a
temporary `captionUploadId`. The Python fetcher tries captions first and skips
the audio download when it finds them. Otherwise it stores audio under the
job's `audioUploadId` and publishes `transcribe`. The worker deletes a temporary
caption object and clears its ID after finishing.

Reruns use separate routes. A direct audio or video rerun publishes
`transcribe` because its audio object is already stored. A YouTube rerun
publishes `yt_fetch` with a fresh caption ID when captions are requested. It
keeps the existing job ID so messages attached to that transcript still point
to the replacement.

**Transcripts are not summarized.** The transcript is stored in Postgres under
the audio job's `audioUploadId`. The user feeds one or more completed jobs to a
model through `chat_message_transcriptions`, which preserves their attachment
order. There is no second job pipeline: the prompt contains the attached
transcripts plus whatever the user types, and the reply streams over the same
SSE endpoint every other chat turn uses.

Job state transitions are **claimed atomically**. A fresh delivery can claim
only a queued job; a broker redelivery can reclaim a processing job. Every claim
gets a new token, which prevents an older worker from writing a stale result if
it later finishes.

## Deployment & scaling

One build artifact, run as different processes:

- `api` — normally a single instance behind an ingress. Its port is
  fixed and known (`PORT`, plus `WS_PORT` for Socket.IO) because clients
  dial it. Do not randomize it.
- `transcribe-worker` (`transcribe-worker/index.ts`) — run **N replicas** to
  scale throughput.
  Because the workers are RabbitMQ _competing consumers_, messages are
  load-balanced across every connected replica automatically. No load balancer
  sits in front of workers — they pull work.

The worker consumes one queue, so there is nothing to select between: every
replica is interchangeable and scaling is purely a replica count. (This used to
be split by a `WORKER_ROLE` env var, which existed only to size the transcribe
and summarize pools separately.)

### No worker port

The worker is a pure queue consumer and runs no HTTP server. There is no
port to configure:

- Nothing dials the worker, so it needs no listening socket for traffic.
- A single shared `.env` can't hand different ports to the N processes built
  from one artifact anyway, so a configurable port wouldn't help.
- The open RabbitMQ consumer socket keeps the Node event loop alive.

Liveness in an orchestrator is therefore a **process / queue-connection**
concern (restart-on-crash, or an exec/TCP probe), not an HTTP health check.

## Why it isn't microservices

It shares the traits that make scaling easy — separate processes, async
message-queue decoupling, independent horizontal scaling of the worker tier —
but not the ones that define microservices:

- One codebase, one deployable. All processes build from the same package
  and import `shared/` by relative path.
- Shared database. API and workers read/write the same Postgres tables;
  microservices own their data privately.
- No independent deploy cadence. You can't ship the worker without shipping
  the API's code — it's the same artifact.

Promoting `shared/` to a published/workspace package would only be needed if the
API and the worker ever became separately built deployables.
