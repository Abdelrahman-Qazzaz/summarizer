# Backend architecture

A modular monolith. Everything under `backend/` is a
single npm package (`summarizer-server`) built from one codebase and one
`shared/` module. It runs as multiple process types that talk to each other (Main API, transcribe-service, etc.)
through a RabbitMQ message queue and a shared Postgres database:

- `api` — the HTTP + WebSocket service clients talk to.
- `transcribe-service` — a background queue worker that does the heavy async
  work (transcription).

They are the same artifact started at different entrypoints, not independently
deployable services. See [Why it isn't microservices](#why-it-isnt-microservices).

## External dependencies

Each process runs a **fail-fast preflight** on boot (`startup.ts` →
`verifyServices`): if any dependency it needs is down, it aborts instead of
starting half-alive.

## Message queues

Defined in `shared/message-queue/messageQueue.ts`:

| Queue              | Producer → Consumer          | Payload                          |
| ------------------ | ---------------------------- | -------------------------------- |
| `transcribe`       | api / fetcher → worker       | `uploadId`                       |
| `transcribe_done`  | worker → api                 | `{ uploadId, userId }`           |
| `yt_fetch`         | api → youtube-fetcher        | `{ uploadId, url, userId }`      |
| `yt_fetch_failed`  | youtube-fetcher → api        | `{ uploadId, userId, error? }`   |

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
    ▲                                                     │ claim job, read audio,
    │                                                     │ call OpenRouter, write
    │◀───────────── transcribe_done ──────────────────────┤ transcript to bucket,
    │                                                     │ record transcript_upload_id
    └── Socket.IO: jobUpdated to the user's room ──▶ browser
```

A YouTube upload takes the same path one step earlier: the API publishes
`yt_fetch`, and the Python youtube-fetcher downloads the audio into the bucket
under the job's `uploadId` before publishing `transcribe` itself.

**Transcripts are not summarized.** The transcript lands in the bucket under its
own key (the audio occupies the job row's own key), and the user feeds it to a
model by attaching the job to a chat message — see
`chat_messages.audio_upload_id`. There is no second job pipeline: the prompt is
whatever the user types, and the reply streams over the same SSE endpoint every
other chat turn uses.

Job state transitions are **claimed atomically** — each handler does
`UPDATE ... SET status='processing' WHERE status='queued' RETURNING *` and bails
if no row comes back. Combined with RabbitMQ delivering each message to one
consumer, this makes running many workers concurrently safe.

## Deployment & scaling

One build artifact, run as different processes:

- `api` — normally a single instance behind an ingress. Its port is
  fixed and known (`PORT`, plus `WS_PORT` for Socket.IO) because clients
  dial it. Do not randomize it.
- `transcribe-service` — run **N replicas** to scale throughput.
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
