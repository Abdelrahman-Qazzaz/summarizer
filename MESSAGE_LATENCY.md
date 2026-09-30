# Message-creation latency

Remaining latency work on `POST /conversations/:id/messages` (and the PATCH
that edits a message), from a read of the code. Line numbers refer to
`e74821c` on `catalog-cache-swr`. Nothing here has been measured in
production; the sizes are estimates.

Already done: the model catalog is served from memory while it refreshes
(`e74821c`), so no request waits on the catalog once a process has it.

| #   | What                                  | Delays                   | When                                 |
| --- | ------------------------------------- | ------------------------ | ------------------------------------ |
| 1   | Rate limiter's Upstash round trip     | First token              | Every request                        |
| 3   | Re-signing week-old image URLs        | First token              | Conversations reopened after ~7 days |
| 4   | Storage delete before an edit streams | First token              | Every edit that drops images         |
| 5   | Two no-op cleanup queries             | End of stream            | Every successful turn                |
| 6   | `persistChatTurn` round trips         | `done` and end of stream | Every successful turn                |
| 7   | Title generation                      | `done` and end of stream | First turn of a conversation         |

"End of stream" matters because the client's `streamMessage` resolves only
when the response closes (`client/src/api/messages.ts:128`), not on `done`,
and the chat UI treats the turn as finished at that point.

## Measure first

`measurePreparation` already times each step of preparing a turn, but it
only logs inside `withPreparationMetrics` (`shared/preparationMetrics.ts:22`),
and nothing calls that since `d70ee27` merged the create and patch
handlers. Wrapping `prepareTurn` in it again gives production numbers. The
most useful one is a single Railway → Supabase database round trip, since
it decides whether 5 and 6 are worth 10 ms or 150 ms.

## 1. The rate limiter's Upstash round trip

`conversationRateLimiter` (`api/src/middleware/rateLimit.middleware.ts:100`)
runs before every conversation route, message sends included, and each
call is an HTTP request to Upstash before the handler starts. The TODO in
`api/src/rateLimit/storage.ts:13` already notes that one API instance could
count in memory.

**Plan:** move rate limiting into the load balancer that horizontal scaling
would add anyway. While there is one load balancer, it can count in memory,
so neither the API nor the load balancer needs Redis for this.

Notes on that plan:

- **Memory can come first.** The API is a single instance today
  (PROBLEMS.md: sockets need it), so an in-memory store in the API is exact
  now. Switching drops the round trip, and the 503 returned when Upstash is
  unreachable, before any load balancer exists.
- **Most limits are per user, not per IP.** Every limiter except the auth
  ones keys on the user id from the session cookie. A load balancer can only
  do the same if it verifies the session JWT itself (it's HS256, so it would
  need the signing secret). Keyed on IP alone, users behind one address (an
  office, carrier NAT) share a budget, the problem the auth limits just got
  fixed for.
- **Railway may not need your own load balancer.** Railway spreads traffic
  across a service's replicas itself, and as far as I know its edge offers no
  rate limiting to configure. Check both before relying on either. The
  sockets don't need one either; see [Scaling out](#scaling-out-the-socket-problem).
- **In-memory counters stop being exact with replicas.** Each replica would
  count on its own, and Railway doesn't pin a user to one replica, so a
  user's effective budget grows with the replica count. When replicas come,
  either divide the limits by the count, go back to a shared store, or move
  the limits into a load balancer then.
- A single load balancer's counters reset when it restarts. That's fine for
  15-minute budgets.

## Scaling out: the socket problem

Not a latency item, but it's what keeps the API at one instance, so it
decides when the rate-limit question above comes up.

**The problem** (PROBLEMS.md #6): each API instance only knows the sockets
connected to it (`socket.join(userId)` in
`api/src/sockets/socketManager.ts`). Job updates arrive on RabbitMQ work
queues (`api/index.ts:23-41`), and a work queue hands each message to one
consumer. With two replicas, instance A can consume `transcribe_done` for a
user whose socket is on instance B, and A's `io.to(userId).emit(...)`
reaches nobody.

**A load balancer doesn't fix it.** It decides where connections land, not
which instance RabbitMQ hands a message to. Sticky sessions aren't needed
either: the client uses websockets only (`transports: ["websocket"]` in
`client/src/hooks/socket/SocketProvider.tsx`), and stickiness only matters
for Socket.IO's HTTP polling fallback.

**Fix: send the notification to every instance.** RabbitMQ is already
there, so use a fanout exchange:

- Each API instance declares its own exclusive, auto-delete queue at startup
  and binds it to a `job_updates` fanout exchange. Every instance gets every
  update and calls `io.to(userId).emit("jobUpdated", ...)`; instances
  without that user's socket do nothing.
- Work that must happen once stays on a work queue. `yt_fetch_failed` marks
  the job failed, so one instance still consumes it, does that, and then
  publishes to the fanout. `transcribe_done` is only a notification (the
  worker has already saved the transcript), so the worker can publish it to
  the fanout directly.

The standard alternative is Socket.IO's Redis adapter, which makes
`io.to(room).emit` reach every instance by itself. It needs a TCP Redis
connection with pub/sub, and every emit costs Upstash commands. With one
event type, the fanout is less to run.

## 3. Re-signing week-old image URLs

**What happens:** each image's signed URL is created once when the upload is
confirmed and saved on the attachment row, valid for 7 days
(`IMAGE_URL_TTL_SECONDS`). Sending a message puts up to 8 recent images from
history into the model's context, and a URL with less than an hour left
(`SIGNED_URL_REFRESH_MARGIN_MS`, `shared/data/images.data.ts:48`) is signed
again before it's sent.

**Why it's slow:** when that happens, these run one after another before
the model call can start (`resolveImageAttachmentUrls`,
`shared/data/images.data.ts:130`, called from `messages.data.ts:320`):

1. the history query,
2. an HTTP request to Supabase Storage to sign the stale URLs,
3. one `UPDATE` per image saving the new URL (`images.data.ts:167`).

Steps 2 and 3 only happen when a conversation with images is picked back up
about a week after those images were uploaded. Everyone else skips them.

**Fix:** the model only needs the URL, not the saved copy, so step 3 doesn't
have to finish first. Return the new URLs as soon as they're signed and save
them without waiting, logging a failed save. A save that fails costs one
extra signing call on a later request, nothing more. That takes one database
round trip off; the signing call has to stay.

## 4. Storage delete before an edit streams

On PATCH, `deleteMessageTail` runs after preparation and before the stream
starts (`api/src/controllers/messages.controller.ts:557`). It ends with
`deleteObjects` (`:404`), an HTTP request to Supabase Storage for the images
that lost their last message.

The ledger rows are already marked deleted by then, and the sweeper removes
any object whose removal didn't finish. So the storage call can run after
the stream has started, or be left to the sweep entirely, instead of
delaying the first token of every edit that drops images.

## 5. Two no-op cleanup queries on every successful turn

`persistChatTurn` already clears the conversation's claim
(`completeConversationTurn`) and the attachment reservations inside its
transaction. The `finally` block in `streamAndPersistMessageTurn` then runs
`unclaimAttachments` and `unclaimConversationTurn` again
(`messages.controller.ts:486-491`) before `events.end()` (`:492`). On
success both match nothing, and `unclaimAttachments` runs even for a message
with no attachments. That's two wasted database round trips before the
stream closes.

**Fix:** end the stream before the cleanup, or skip the cleanup when the
persist succeeded. The cleanup is only needed on the failure paths.

## 6. `persistChatTurn` round trips

`persistChatTurn` (`shared/data/messages.data.ts:572`) takes about six round
trips before `done`: begin, insert the user message, insert the assistant
message and link the attachments, complete the turn on the conversation,
delete the reservations, commit.

The user message goes first only because the database generates its id,
which the links need. With ids generated in the app, the rest can be sent
without waiting on each other, or merged into one statement with CTEs,
bringing it to about two or three.

## 7. `done` waits for the title on a first turn

On a conversation's first turn, the title is generated alongside the reply
(`openai/gpt-4o-mini`, 15-second timeout) and awaited before the turn is
saved (`messages.controller.ts:466`). It usually finishes first, but with a
fast model and a short reply, `done` waits for it.

**Fix:** save the turn without the title and write the title when it
arrives, pushing it to the client over the socket as other background
updates are.
