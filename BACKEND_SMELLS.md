# Backend code smells

Scope: `backend/` on `main`. Written at 029e2de and rechecked at 371e3d2, which the line numbers refer to. None of these are bugs today. They make the code harder to read or change safely. Bugs are in BACKEND_BUGS.md.

## Dead or test-only code

- **`findRecentMessagesWithContext`, `hydrateContextMessages` and `ContextMessage`** (`shared/data/messages.data.ts:80`, `:334`, `:392`). Nothing calls them; `findCreateMessageHistory` replaced them. The index comment in `shared/db/schema.ts:181` and a test comment in `test/api/messages.test.ts:208` still name the old function.
- **Preparation metrics never run in production.** Only tests call `withPreparationMetrics`, so every `measurePreparation` in `shared/data/images.data.ts:135` just calls `run()`. Its extra arguments, including the `persistUrlsPromiseAllId` UUID minted on each call, make the image signing code harder to read and do nothing.
- **Commented-out line** in `api/src/sockets/socketManager.ts:34`.

## Untyped request context

- Validation middleware copies whatever keys the schema outputs into `c.set` (`api/src/middleware/validate.middleware.ts:57`), and handlers read them back with `c.get(...)` plus a hand-written type annotation. Hono's `Variables` generic isn't used, so a misspelled key or the wrong annotation still compiles.
- `getUserJobs` reads `c.get("limit")`, a bare string, where every other read uses `CTX_KEYS` (`api/src/controllers/jobs.controller.ts:49`). It is also the one handler not named `handle*`.
- `CTX_KEYS.messageAttachmentsIds` holds attachment objects, not ids, and its value is `"attachments"` (`shared/keys.ts`).
- `FORM_KEYS` names request fields that are JSON bodies now, since uploads stopped using multipart.

## Misplaced or stale comments

- The doc comment for `POST /conversations/:id/messages` sits above `mergeTranscriptsIntoContent` rather than `handleCreateMessage` (`api/src/controllers/messages.controller.ts:249`).
- The "Bounds on what one turn can cost" comment is separated from its constants by a blank line (`messages.controller.ts:30`).
- An orphaned doc comment ("Scoped by conversation as well as owner…") is stacked above the real one for `deleteOwnedMessage` (`shared/data/messages.data.ts:435`).
- The comment above `findChatModel` describes `validateChatModelOutput` (`shared/ai/ai_chat_client.ts:207`).
- Two open TODOs head `messages.controller.ts`, one of them "refactor and fix patching&deletion handlers".

## Modules reaching across layers

- `shared/cache/redis.ts:6` calls `getApiEnv()`, which requires the API-only variables (WorkOS, Upstash). `shared/ai/ai_transcribe_client.ts` imports the cache, so the worker is one call away from exiting at runtime on a missing API variable.
- `shared/env.ts:86` parses `drizzleEnv` when the module is imported, in every process, though only `drizzle.config.ts` uses it.
- `api/index.ts:1` calls `getApiEnv()` above the import that defines it. It works because ESM hoists imports, but it reads like a use-before-define.

## Indirection

- `images.deleteOwnedUnlinkedUnreservedImageAttachment(s)` only forward to `attachments.deleteOwnedUnlinkedUnreservedAttachment(s)` with `kind: "image"` (`shared/data/images.data.ts:332`). `uploads.confirmCheckedUpload` is the same kind of pass-through, and it is already on your list of `uploads.ts` decisions.
- `deleteOwnedUnlinkedUnreservedAttachments` decides whether to open a transaction by checking `executor === db` and then calling itself (`shared/data/attachments.data.ts`). Callers can't tell from the signature that passing `db` behaves differently from passing a transaction.
- `handleCreateMessage` wraps `prepareMessageTurn` in `async () => { const prepared = await …; return prepared; }`. `streamAndPersistMessageTurn` takes five parameters, and two of them (`claimToken` and `claimPromises`) always come from the same `createClaimData` call.

## Resource use

- `withAdvisoryLock` keeps a transaction open for the whole sweep, storage HTTP calls included, while the sweep's own queries run on other pool connections (`shared/data/advisoryLock.data.ts:10`). One connection sits idle in transaction for as long as the sweep runs.

## Naming and small things

- `getRiderctUrl` is misspelled (`api/src/auth/auth.ts:20`). So is "rhobust" in `ai_chat_client.ts`.
- `DELETE /upload/image/:id` spends the image _read_ budget (`api/src/routes/images.router.ts:52`).
- File and identifier casing is mixed: `ai_chat_client.ts`, `ai_client` and `try-catch.ts` sit next to camelCase everywhere else, and the column is `YT_sourceUrl`.
- `AudioTranscriptionJobs.source` is free `text`, with the allowed values listed only in a comment (`shared/db/schema.ts:89`). The other status-like columns are `pgEnum`s.
- `mergeTranscriptsIntoContent` casts `get(...) as string` (`messages.controller.ts:268`). This relies on an earlier size check that sits in a different function.
