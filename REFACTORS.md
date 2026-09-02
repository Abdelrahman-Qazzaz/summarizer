# Easy refactors

Survey of low-risk line, function, export, and branch reductions. No code was
changed.

Checked against `main` at `a660952` ("Fail a job whose queue publish doesn't go
through"), working tree clean apart from an untracked `fixes.md`. Every line
number below is from that commit.

Each claim was verified by grep against this tree, including the ones that did
not survive — those are listed under [Checked and dropped](#checked-and-dropped)
so nobody re-derives them.

| #   | Where                                                      | Win                                    | Effort |
| --- | ---------------------------------------------------------- | -------------------------------------- | ------ |
| 1   | `messages.controller.ts` `handlePatchMessage`              | −35 lines, 11 fewer branches           | 30 min |
| 2   | Upload-rejection switch, duplicated across two controllers | −25 lines, one copy of five messages   | 20 min |
| 3   | `messages.data.ts:52-79`                                   | −12 lines, one function instead of two | 10 min |
| 4   | `shared/env.ts` worker tier                                | −12 lines, −3 exports                  | 10 min |
| 5   | Two non-exports                                            | −2 exports                             | 5 min  |
| 6   | Duration rounding ×11                                      | −10 repetitions                        | 15 min |
| 7   | `messages.controller.ts` turn building                     | −8 lines                               | 15 min |
| 8   | Error-to-string idiom ×5                                   | −5 repetitions                         | 15 min |
| 9   | `useChatSend.ts` `send`                                    | −25 lines out of a 120-line callback   | 20 min |
| 10  | `SourcesProvider.tsx` `addFiles`                           | flattens 3 levels of nesting           | 20 min |

---

## 1. `handlePatchMessage` repeats `await releaseClaim()` twelve times

`api/src/controllers/messages.controller.ts:589-781` — 193 lines, and
`await releaseClaim();` appears 12 times, 11 of them immediately followed by a
`return c.json(…)`. Every early exit has to remember to release, and the
compiler will not tell you when one forgets.

The fix is already in the file. `MessageRequestError` (line 345) exists for
exactly this and is used by `handleCreateMessage`: throw it instead of
returning, and let the one catch that already runs `await releaseClaim()` map
it to a response.

```ts
} catch (error) {
  await releaseClaim();
  if (error instanceof MessageRequestError)
    return c.json(error.body, error.status);
  throw error;
}
```

The four `patchResult.status` branches (lines 717-736) then collapse into a
lookup:

```ts
const PATCH_FAILURES = {
  claim_lost: [409, "Conversation changed or the edit claim was lost"],
  attachments_changed: [409, "Attachments changed during the edit"],
  not_found: [404, "Message not found"],
  not_user: [400, "Only user messages can be edited"],
} as const;
```

The file's own TODO at line 2 asks for this ("refactor and fix patching&deletion
handlers"). Highest payoff on the list, and the least inventive — it applies the
pattern the sibling handler in the same file already uses.

## 2. The upload-rejection switch is written twice

`api/src/controllers/upload.controller.ts:52-76` (audio) and
`api/src/controllers/images.controller.ts:53-71` (image) both switch over
`upload.reason` with the same five cases in the same order. Two of the five are
byte-identical:

```ts
case "already-confirmed":
  return c.json({ message: "This upload was already confirmed" }, 409);
case "expired":
  return c.json({ message: "This upload has expired; upload the file again" }, 410);
```

The other three differ only by the noun ("audio" / "image") and, for
`wrong-type`, whether the received content type is echoed back. Both handlers
then repeat the `already-confirmed` 409 a third time after the confirm call
(`upload.controller.ts:89`, `images.controller.ts:90`).

One `uploadRejection(upload, noun)` returning `[status, body]` next to
`checkUpload` in `shared/uploads.ts` covers both, and the five messages stop
being able to drift apart. This is the same shape as #1 — a handler hand-mapping
a result union to responses — so the two are worth doing together.

## 3. `messageIsAfter` and `messageIsBefore` are the same function

`shared/data/messages.data.ts:52-79`. Twenty-eight lines, identical except that
one uses `gt` where the other uses `lt`. Both are private; there are 5 call
sites between them.

```ts
function messageIsOn(side: typeof gt | typeof lt, cursor: MessageCursor) {
  return or(
    side(ChatMessages.createdAt, cursor.createdAt),
    and(
      eq(ChatMessages.createdAt, cursor.createdAt),
      side(ChatMessages.role, cursor.role),
    ),
    and(
      eq(ChatMessages.createdAt, cursor.createdAt),
      eq(ChatMessages.role, cursor.role),
      side(ChatMessages.id, cursor.id),
    ),
  );
}
```

Keep `messageIsAfter` / `messageIsBefore` as one-line wrappers if the call sites
read better with names — that still halves the body and leaves one place to fix
if the tuple ordering ever changes. The three-column cursor comparison currently
has to be verified twice.

## 4. The worker env tier is an alias nothing calls

`shared/env.ts:77-107`:

- `workerEnvSchema = baseEnvSchema` — a pure alias, as its comment says ("the
  worker consumes one queue, so it needs nothing beyond the base env")
- `export type WorkerEnv = z.infer<typeof workerEnvSchema>` (line 86) — same as
  `BaseEnv`
- `getWorkerEnv()` plus its `cachedWorkerEnv` (lines 103-107) — **zero callers**.
  The transcribe worker reads `getBaseEnv()`.

The only thing keeping it alive is `test/unit/env.test.ts`, which tests
`baseEnvSchema` under the other name. Deleting all three and pointing that
describe block at `baseEnvSchema` removes ~12 lines and 3 exports, and removes a
second name for one concept.

## 5. Two exports that nothing outside the file imports

| Symbol               | File                                  | Note                         |
| -------------------- | ------------------------------------- | ---------------------------- |
| `createMessage`      | `shared/data/messages.data.ts`        | used 3× inside the file only |
| `MAX_MESSAGE_LENGTH` | `api/src/schema/messages.schema.ts:8` | used once, same file         |

Drop the keyword on both.

A further six are exported only so tests can reach them — `MAX_CONTEXT_CHARS`
(`messages.controller.ts:67`, 0 production imports, 9 test uses), `setCache` and
`resetCacheMemo` (`shared/cache/cache.ts`), `WORKOS_REDIRECT_URI`
(`api/src/auth/auth.ts`), `apiEnvSchema` (`shared/env.ts`), plus
`sweepUnusedObjects` (`shared/sweeper.ts`). That is a legitimate call, but worth
making deliberately — a comment saying so is enough, and stops the next person
reading it as dead.

**Do not touch** `chatRoleEnum`, `attachmentKindEnum`, or `storedObjectKindEnum`
in `shared/db/schema.ts`, which look like the same case. drizzle-kit discovers
enums through the schema module's exports; unexporting them can change generated
migrations.

Worth knowing: `npx knip` dies on this checkout with an
`ArrayBuffer allocation failed` inside `oxc-parser`, so it is not catching any
of this right now. The config in `knip.json` looks fine, so this is a bug in
knip's parser worth chasing separately — until then, unused exports accumulate
unreported.

## 6. The same duration rounding is written eleven times

`Math.round((a - b) * 100) / 100` appears at:

- `shared/preparationMetrics.ts:48,49,51`
- `api/src/controllers/messages.controller.ts:523,525,527`
- `scripts/benchmarkDatabaseConnections.ts:34,45,56,65`
- `test/benchmarkReservationRoundTrips.ts:28`

One exported `roundMs(ms)` — or `msSince(mark)`, which fits 8 of the 11 sites
directly — removes the repetition and puts the precision choice in one place.
`shared/preparationMetrics.ts` is where it belongs, since that module already
owns the convention.

(The `preparation-metrics-spans` branch reshapes that module and adds exactly
this helper, but it is not on `main`, so the count above is what `main` has.)

## 7. Two context builders share their last four lines

`assembleCreateMessageContext:159-163` and `assembleConversationContext:253-257`
end with the same decision:

```ts
turns.unshift(
  imageUrls.length > 0
    ? buildUserTurn(content, imageUrls)
    : { role: message.role, content },
);
```

A `toTurn(role, content, imageUrls)` used by both is eight lines smaller and puts
"a turn with images is built differently" in one place. The two functions should
stay separate otherwise — one takes already-hydrated history, the other hydrates
under a budget, and merging them would cost more than it saves.

## 8. `error instanceof Error ? error.message : String(error)` ×5

`shared/preflight.ts:31`, `api/src/controllers/messages.controller.ts:89`,
`transcribe-worker/transcribeJob.ts:96`,
`scripts/benchmarkDatabaseConnections.ts:125`, `scripts/baseline.ts:99`.

`shared/logger/index.ts` already has `normalizeError` doing this properly
(name, message, stack) and `logger.error(msg, error, ctx)` already takes the raw
error. The log-site cases exist because `warn` has no error parameter. Giving
`warn` the same signature as `error` removes the idiom at those sites and gets
stack traces into warnings for free. The client has the same helper under a
different name (`errorMessage` in `client/src/api/http.ts:34`).

## 9. `send` is a 120-line `useCallback`

`client/src/components/chat/useChatSend.ts:146-268`. Two extractions, no
restructuring:

- **The delta buffer** (lines 176-213): `buffered`, `flushTimer`, `flush`, and
  the `finally` that clears the timer are a self-contained throttled writer.
  Lift it to a module-level `createDeltaBuffer(onFlush)` and `send` loses 25
  lines of timer bookkeeping.
- **Dropping a key from a record** appears three times — `dropPending`
  (line 137) and twice in the `finally` (lines 269-270). One
  `without(record, ...keys)` helper covers all three.

## 10. `addFiles` rejects files three different ways

`client/src/sources/SourcesProvider.tsx:220-285`. Three
`toast.show({ kind: "error", message: … }); continue;` blocks (lines 233, 241, 248) nested two deep inside a loop. A local

```ts
const reject = (message: string) => {
  toast.show({ kind: "error", message });
  return false;
};
```

lets each guard become a single line and takes the nesting down a level.

Also in this file: `const patch = (fields) => patchSource(draftKey, localId, fields)`
is defined identically in `runFileUpload` (line 141) and `runYoutubeFetch`
(line 198). A `patcherFor(draftKey, localId)` on `patchSource` covers both.

---

## Checked and dropped

Things that look like wins from a distance and are not:

- **`getAudioFile`** was dead, and is already gone — the storage refactor
  (`218c73c`, `d6ca0d8`) removed it. `shared/bucket.ts` is clean on this.
- **`sweepUnusedObjects`** reads as unused but is not: `scheduleSweeper` calls
  it in the same file, and `transcribe-worker/index.ts:5` wires that up. Only
  its `export` is test-driven.
- **`deleteOwnedUnlinkedUnreservedImageAttachment` / `…Attachments`** look like a
  redundant singular/plural pair. Both have real production callers, and the
  singular one does extra work (bucket cleanup inside the transaction).
- **`createSignedUrl` / `createSignedUrls`** in `shared/bucket.ts` are likewise
  not a wrapper pair — they call different storage APIs, and the plural one
  groups by kind to get one TTL per request.
- **`transcriptModelRef.current ?? DEFAULT_TRANSCRIPTION_MODEL`** in
  `SourcesProvider.tsx` appears twice and looks redundant next to the
  `resolveDefaultModel` call above it. It is not: `resolveDefaultModel` returns
  `string | null`.
- **The pgEnum exports** in `shared/db/schema.ts` — see the caveat under #5.
