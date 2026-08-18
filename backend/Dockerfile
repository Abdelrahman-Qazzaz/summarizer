# syntax=docker/dockerfile:1

# One image, four entrypoints. api and transcribe-worker are the same artifact
# started differently (see ARCHITECTURE.md); migrate and baseline are the
# operational one-shots. Build context is backend/ — it imports nothing outside
# itself.

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only. Every one is pure JS, so there is nothing to
# compile and no build toolchain in the final image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
# Read by scripts/migrate.ts at runtime, relative to this working directory.
COPY drizzle ./drizzle

USER node

# Overridden per process:
#   transcribe-worker  node dist/transcribe-worker.js
#   migrate            node dist/migrate.js
#   baseline           node dist/baseline.js
CMD ["node", "dist/api.js"]
