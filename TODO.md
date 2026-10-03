# To do

Open work, so none of it gets lost. Details for the latency and scaling
items are in [MESSAGE_LATENCY.md](MESSAGE_LATENCY.md).

## Message-creation latency

1. **Measure first.** Wrap `prepareTurn` in `withPreparationMetrics` again so
   the timing already in the code logs. The cost of one Railway → Supabase
   database round trip decides whether #6 is worth doing.
2. **#4:** on an edit, delete the dropped images from storage after the
   stream starts, not before.
3. **#3:** save re-signed image URLs without making the model call wait on
   the write.
4. **#6:** cut `persistAndUnclaimChatTurn` from about six round trips to two or three,
   using ids generated in the app.
5. **#7:** don't make `done` wait for a first turn's title; save it later
   and push it over the socket.

## Scaling out (only when replicas are needed)

6. **Fanout for job updates.** A RabbitMQ fanout exchange so every API
   instance hears every job update. This is what blocks running more than
   one instance.
7. **Then decide where rate limits go:** a load balancer that verifies the
   WorkOS access token, a shared store, or limits divided by the replica
   count. The limits are already plain data in
   `api/src/rateLimit/policies.ts`.

## From earlier sessions

- **Spoof test after the next API deploy.** The auth limits key on
  `X-Real-IP`, which assumes clients can't set it. Temporarily log only
  `x-real-ip`, `x-forwarded-for`, `fastly-client-ip` and `x-railway-edge`
  (never all headers: that logs cookies). Get your IP from
  `curl https://ifconfig.me`, then run
  `curl -H "X-Forwarded-For: 1.2.3.4" -H "X-Real-IP: 1.2.3.4" https://<api>/health`.
  It passes if `x-real-ip` is your real IP and never `1.2.3.4`. If
  `fastly-client-ip` is present, check `x-real-ip` isn't a Fastly address.
  Repeat about a week later; Railway's routing has alternated on that
  timescale. If it fails, `getClientIpKey` has to change.
- **Queue publish gap.** A process that dies between committing a job's rows
  and publishing its work leaves the job `queued` with nothing coming for it.
  (A publish the broker refuses already fails the job.) Only worth fixing if
  stuck jobs show up: a periodic pass that republishes jobs `queued` past a
  per-source threshold. YouTube jobs stay `queued` for the whole fetch, so
  they need a longer one.
- **`shared/uploads.ts`.** Decide whether to keep it, reshape it, or remove
  it.
