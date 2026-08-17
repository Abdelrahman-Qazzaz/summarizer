# Defence deck — Summarizer

> 14 slides. Each `##` is one slide. **On slide** = what goes on the slide (keep it this short — the panel reads faster than you talk). **Say** = your speaker notes, not for the slide.
>
> Target: 12–15 minutes. The two slides that win this defence are 6 (claim tokens) and 7 (multiple transcripts) — everything else is setup.

---

## 1 — Title

**On slide**
- Summarizer: A Chat-Based System for Transcribing and Querying Audio, Video and YouTube Sources
- Abdelrahman Qazzaz
- Supervisor: [NAME]
- Department of Computer Science, School of Computing — German Jordanian University, 2026

**Say**
- Nothing. Read the room, then move on. Don't narrate your own title slide.

---

## 2 — The problem

**On slide**
- More and more information arrives as **speech**: lectures, meetings, interviews, video
- Speech is easy to record, hard to *use*
- You can't search it, quote it, or compare two of them

**Say**
- Open with the concrete version: "You have a ninety-minute recorded lecture and one question about it. Right now your only option is to scrub through it."
- That's the whole problem in one sentence. Don't over-explain.

---

## 3 — Why transcription alone isn't the answer

**On slide**
- Transcription turns an unsearchable medium into a **long** one
- 90 minutes → tens of thousands of words
- The reader still has to find the answer themselves

**Say**
- This is the slide that justifies the project existing. Transcription services stop here and call it done.
- What changed: LLMs can take a long text as context and answer a specific question about it. So: transcribe, then *ask*.

---

## 4 — What Summarizer does

**On slide**
- Submit **audio, video, or a YouTube link**
- System extracts speech → transcribes → stores it
- Ask questions in chat — **several transcripts at once, in one message**
- *(screenshot: the chat surface with two source chips attached)*

**Say**
- Land the differentiator here, early: one message can carry several recordings.
- The interesting questions are comparative — "where do these two lectures disagree" — and those need multiple transcripts in front of the model at the same time.

---

## 5 — Architecture

**On slide**
- *Figure 1 from the report — the architecture diagram*
- Modular monolith: **one artifact, three process types**
  - `api` — HTTP + WebSocket
  - `transcribe-worker` — queue consumer, **N replicas**
  - `youtube-fetcher` — Python, `yt-dlp`
- RabbitMQ · PostgreSQL · object storage · Redis

**Say**
- Justify the choice before they ask: not microservices, because the processes share one database and one deploy. Separate services would add operational cost and buy nothing.
- What I actually needed was to scale transcription independently of the API — the message queue gives me that on its own.
- Workers are competing consumers, so scaling is a replica count. No load balancer: workers pull.

---

## 6 — Correctness: atomic claiming and fencing tokens ★

**On slide**
- Transcription is slow, paid, and can fail — it can't run in a request
- RabbitMQ **redelivers** an unacknowledged message when a consumer's connection drops
- …but the original worker may still be alive and still finish
- **Fix:** claim atomically, stamp a new token, make every terminal write conditional on still owning it
- Transcript + completion are written in **one transaction**

**Say**
- This is your strongest engineering slide. Slow down here.
- Walk the failure: worker A gets partitioned → broker redelivers → worker B transcribes and writes → worker A comes back and writes a stale result over it.
- The claim is one conditional UPDATE: a fresh delivery may claim only a `queued` job, a redelivery may reclaim a `processing` one. Every claim writes a new token. A superseded worker's write matches no row and is discarded.
- If asked where you got it: this is the standard fencing-token pattern (Kleppmann, ref [7]).

---

## 7 — Multiple transcripts per message ★

**On slide**
- Join table with a **`position`** column → an *ordered list*, not a single reference
- Order staged = order persisted = order the model receives
- Attached transcripts **replay** on later turns
- Attaching an existing transcript costs nothing — no re-upload, no re-transcription

**Say**
- This is the feature the whole system is designed around, and it shows up at every layer: schema, context assembly, UI.
- The 100,000-character context budget is spent using stored `charCount` values, so I decide *which* transcripts fit without reading any of them, then fetch only the ones admitted.
- Note the cost argument — transcription is paid, so referencing by ID instead of copying is a money decision, not just a tidy one.

---

## 8 — Streaming replies

**On slide**
- Replies stream over **Server-Sent Events**
- The model run is **decoupled** from the response stream
- Client disconnects mid-answer → the turn still completes and is still stored
- The stored conversation is the source of truth, not the stream

**Say**
- A dropped connection is a *display* problem, not a data-loss problem. The client refetches and the answer is there.
- Why not `EventSource`: it can't send a POST body, so the client uses `fetch` plus a stream reader.
- If asked "why no Stop button": stopping the stream wouldn't stop the model or the cost, and the reply would reappear on refetch. Deliberate, not missing.

---

## 9 — Client-side media preparation

**On slide**
- Video is decoded and audio extracted **in the browser** (ffmpeg.wasm)
- Re-encoded to mono, 16 kHz Opus — matched to speech recognition
- The original video **never leaves the device**
- Concurrent jobs serialised — one FFmpeg instance, one filesystem

**Say**
- Faster uploads, less storage, and a privacy story you get for free.
- The serialisation point is a real bug I hit: two files dropped together overwrote each other's working files, because it's one WebAssembly instance with one virtual filesystem.

---

## 10 — Live demo

**On slide**
- *(no bullets — go to the app)*

**Say — demo script, rehearse this exact path**
1. Paste a YouTube link → the prompt offers to transcribe it → accept.
2. While it transcribes, drop a second recording. Point at the meters running.
3. Show send is **disabled**, and the line naming what it's waiting for.
4. Both land → ask a comparative question across both.
5. Answer streams in.
6. Open the sources drawer → attach an older transcript to a new message with no re-upload.

- **Have a recorded fallback.** Live transcription depends on a paid third-party API and the venue's WiFi.
- Use a short clip. Don't stand there while a 90-minute lecture transcribes.

---

## 11 — Engineering practice

**On slide**
- 174 source files · 312 commits · 25 test files, 174 test cases
- API tests · unit tests · worker tests · Python fetcher tests
- Fail-fast preflight on every process
- Rate limiting per user; per-user object namespacing

**Say**
- Tests target the correctness-critical paths: job claiming, transcript persistence, queue publisher and consumer.
- Preflight: if a dependency is down, the process aborts instead of starting half-alive and failing later in a confusing way.
- If asked why the report says 30 files / 169 cases: that count was taken before the last change and was slightly off; these are the current numbers.

---

## 12 — Known limitations

**On slide**
- Retried requests aren't idempotent → a lost response can duplicate a paid job
- A failed re-run can get stuck queued
- Dead-letter exchanges declared but not wired
- Message history isn't paginated

**Say**
- **Do not skip this slide.** Volunteering your own limitations is the single best move in a defence — it moves you from defending to discussing, and it pre-empts the question they were going to ask anyway.
- Real example, worth telling: a YouTube fetch hit a transient 403 from the media CDN. It succeeded on a manual retry — but the handler nacks without requeue, so the job had been dropped rather than retried. I've since added retry-with-re-extraction in the fetcher (the signed URL is what gets rejected, so a retry has to re-extract), but the queue-level dead-letter gap above is still open.
- Each one has a known fix: idempotency keys on the write endpoints, a recovery path for requeue, wiring the retry/DLX topology, cursor pagination.
- These are documented in the repo, not discovered this morning.

---

## 13 — Future work

**On slide**
- Close the limitations above first
- Speaker diarisation and timestamped citations back to the audio
- Retrieval over transcripts to lift the context ceiling
- Sharing a conversation

**Say**
- Timestamped citations is the strongest one — "the model claims X, here's the second in the recording where it was said." It attacks the trust problem directly.
- Retrieval matters because the current design puts whole transcripts in context; that has a hard ceiling. Selecting relevant spans is the documented approach for long meeting transcripts (ref [6]).

---

## 14 — Summary

**On slide**
- Speech → transcript → **conversation**
- Several recordings, one question
- Asynchronous by necessity, correct under redelivery
- Thank you — questions?

**Say**
- Three sentences maximum, then stop talking and let them ask.

---

## Likely questions — prepare answers

| They ask | Your answer |
| --- | --- |
| Why not microservices? | Shared database, shared deploy cadence. The only thing I needed was independent scaling of transcription, and the queue gives me that without the operational cost. |
| Why not train your own ASR model? | Out of scope and worse. Large weakly-supervised models (ref [3]) generalise across accents and domains zero-shot; the engineering contribution here is the system around it. |
| What if two workers process the same job? | Fencing tokens — slide 6. Only the current claimant can write. |
| What stops one user reading another's data? | Every table is keyed by owner and every query is scoped by it; storage keys are namespaced per user, so a non-owner's request fails structurally. |
| How much does it cost to run? | Transcription and model calls are the paid parts. That's why transcripts are referenced by ID rather than re-transcribed, and why rate limits are per user. |
| How accurate is the transcription? | I use a hosted ASR service and expose its model choice, including re-running a recording with a different model. I haven't benchmarked accuracy myself — say so plainly, don't invent a number. |
| Why is there no Stop button? | Slide 8. Aborting the stream stops neither the model nor the cost, and the reply reappears on refetch. |

---

### Before you present

- [ ] Fill in the supervisor's name on slide 1
- [ ] Export Figures 1 and 2 from the report as images for slides 5 and 6
- [ ] Take a fresh screenshot for slide 4
- [ ] **Record the demo as a fallback video**
- [ ] Rehearse the slide-10 path once end to end, timed
- [ ] Check every number on slide 11 still matches the repo
