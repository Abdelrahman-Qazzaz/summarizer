  ## Production blockers

  1. Critical — jobs can be permanently lost
      - Uploads perform bucket → database → RabbitMQ as separate operations. A failure between them leaves
        orphaned files, stranded rows, or duplicate paid jobs when clients retry: backend/api/src/
        controllers/upload.controller.ts:17.

      - Node consumers discard every failed delivery with nack(..., false, false): backend/shared/message-
        queue/messageQueue.consumer.ts:27.

      - Retry/DLX exchanges exist, but queues are not configured to use them: backend/shared/message-queue/
        messageQueue.topology.ts:18.

      - The Python fetcher publishes non-persistent, unconfirmed messages and then ACKs the input. A broker/
        network failure can lose the downstream transcription event: youtube-fetcher/app/
        message_queue.py:44.

     This needs transactional outbox/idempotency, real retry policies, DLQs, and publisher confirms.

  2. High — upload limits are enforced too late

     The API loads the entire multipart request into memory with formData() before checking whether it
     exceeds 100 MB: backend/api/src/middleware/validate.middleware.ts:79.

     An authenticated client can send concurrent oversized bodies and exhaust API memory. There is no
     checked-in ingress/body-size configuration providing an earlier limit.

  3. High — a crash can permanently lock a conversation

     A database claim token is written without a timestamp, lease, or expiry: backend/api/src/data/
     conversations.data.ts:58.

     If the API crashes after claiming but before persisting or releasing, that conversation can return 409
     forever. The Node processes also have no graceful SIGTERM shutdown/drain handling: backend/api/
     index.ts:14.

  4. High — production dependency audit fails

     npm audit --omit=dev reported:
      - 6 vulnerable production packages
      - 5 high severity
      - 1 moderate severity

     Applicable findings include Socket.IO/Engine.IO/WebSocket memory or connection exhaustion
     vulnerabilities. The pinned runtime versions are visible in backend/package.json:18. Some reported Hono
     advisories concern unused features, but the audit still cannot pass as shipped.

  5. High — no production delivery path exists
      - No start or build script; only development commands using tsx watch: backend/package.json:6.
      - No service Dockerfiles, deployment manifests, or runtime version guarantees.
      - No checked-in database migrations; the only DB command is drizzle-kit push.
      - No CI configuration enforcing tests, lint, audits, or migrations.
      - The Python service has no packaging/runtime configuration beyond requirements files.

  6. Medium — API cannot safely scale horizontally

     Socket rooms are process-local, while RabbitMQ notifications are consumed by individual API processes:
     backend/api/src/sockets/socketManager.ts:10, backend/api/index.ts:19.

     With multiple API replicas, the process consuming an update may not own the user’s socket. The
     architecture therefore requires a single API instance, creating a single point of failure.
