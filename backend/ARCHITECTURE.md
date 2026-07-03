# Backend architecture

A modular monolith. Everything under `backend/` is a
single npm package (`summarizer-server`) built from one codebase and one
`shared/` module. It runs as multiple process types that talk to each other (Main API, transcribe-summarize-service, etc.)
through a RabbitMQ message queue and a shared Postgres database:

- `api` — the HTTP + WebSocket service clients talk to.
- `transcribe-summarize-service` — a background queue worker that does
  the heavy async work (transcription and summarization).

They are the same artifact started at different entrypoints, not independently
deployable services. See [Why it isn't microservices](#why-it-isnt-microservices).

## External dependencies

Each process runs a **fail-fast preflight** on boot (`startup.ts` →
`verifyServices`): if any dependency it needs is down, it aborts instead of
starting half-alive.

## Message queues

Defined in `shared/message-queue/messageQueue.ts`:

| Queue             | Producer → Consumer                        | Payload                       |
| ----------------- | ------------------------------------------ | ----------------------------- |
| `transcribe`      | api → transcribe worker                    | `uploadId`                    |
| `summarize`       | transcribe worker / api → summarize worker | `uploadId`                    |
| `summarize_chunk` | summarize worker → api                     | `{ uploadId, userId, delta }` |
| `transcribe_done` | transcribe worker → api                    | `{ uploadId, userId }`        |
| `summarize_done`  | summarize worker → api                     | `{ uploadId, userId }`        |

The channel uses `prefetch(1)` **per consumer**, so a single worker process
handles at most one transcribe job **and** one summarize job at a time.
Handlers are `await`ed before `ack`; a thrown handler `nack`s (no requeue).

## End-to-end flow (audio upload)

```
  browser
    │  upload audio
    ▼
  ┌──────┐  create AudioTranscriptionJobs (queued)      ┌───────────────────┐
  │ api  │ ───────────── transcribe ───────────────────▶│ transcribe worker │
  └──────┘                                               └───────────────────┘
    ▲  ▲                                                   │ claim job, read audio,
    │  │                                                   │ call OpenRouter, write
    │  │◀──────────── transcribe_done ────────────────────┤ transcript to bucket,
    │  │                                                   │ upsert TextSummarizationJobs
    │  │                                                   ▼
    │  │                                                 ── summarize ──▶┌──────────────────┐
    │  │                                                                 │ summarize worker │
    │  │◀──────── summarize_chunk (streamed deltas) ────────────────────┤ claim job, read  │
    │  └───────── summarize_done ─────────────────────────────────────◀─┤ transcript,      │
    │                                                                    │ stream summary   │
    └── Socket.IO: jobChunk / jobUpdated to the user's room ──▶ browser  └──────────────────┘
```

Direct text uploads skip transcription: the API creates a
`TextSummarizationJobs` row and publishes straight to `summarize`.

Job state transitions are **claimed atomically** — each handler does
`UPDATE ... SET status='processing' WHERE status='queued' RETURNING *` and bails
if no row comes back. Combined with RabbitMQ delivering each message to one
consumer, this makes running many workers concurrently safe.

## Deployment & scaling

One build artifact, run as different processes:

- `api` — normally a single instance behind an ingress. Its port is
  fixed and known (`PORT`, plus `WS_PORT` for Socket.IO) because clients
  dial it. Do not randomize it.
- `transcribe-summarize-service` — run **N replicas** to scale throughput.
  Because the workers are RabbitMQ _competing consumers_, messages are
  load-balanced across every connected replica automatically. No load balancer
  sits in front of workers — they pull work.

### `WORKER_ROLE`

Each worker attaches queue consumers based on `WORKER_ROLE`
(`workers/index.ts`):

| `WORKER_ROLE`   | Consumes                   |
| --------------- | -------------------------- |
| `all` (default) | `transcribe` + `summarize` |
| `transcribe`    | `transcribe` only          |
| `summarize`     | `summarize` only           |

This lets you scale the two stages independently with the same image —
e.g. `WORKER_ROLE=transcribe` ×5 and `WORKER_ROLE=summarize` ×2 when
transcription is the bottleneck. Locally this is not needed, so `npm run dev` runs one worker with
the default `all` role, so it's a single process.

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

`WORKER_ROLE` specializes _replicas of the same program_; it does not turn
transcribe and summarize into independent services. Promoting `shared/` to a
published/workspace package would only be needed if the services ever became
separately built deployables.
