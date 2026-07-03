import { getWorkerEnv } from "../../shared/env";

const env = getWorkerEnv();

import { attachListeners } from "./workers";
import { verifyWorkerServices } from "./startup";
import { logger } from "../../shared/logger";

// Fail-fast preflight: connects RabbitMQ and pings every dependency, aborting
// startup if any is down. (This used to run inside createApp(); the worker no
// longer serves HTTP, so it's called directly here.)
await verifyWorkerServices();

attachListeners(env.WORKER_ROLE);

// No HTTP server. The worker is a pure queue consumer — nothing dials it, it
// pulls from RabbitMQ. The open consumer socket keeps the Node event loop
// alive, and liveness is a process / queue-connection concern rather than an
// HTTP endpoint, so there is no port to bind or configure.
logger.info("transcribe-summarize-service started", { role: env.WORKER_ROLE });
