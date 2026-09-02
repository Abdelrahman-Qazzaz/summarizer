  - [P2] Attachments can be deleted while the model is responding. backend/api/src/controllers/messages.controller.ts:483 validates attachments, calls the model, then
    attaches them during persistence at backend/api/src/data/messages.data.ts:780. During that gap, the delete endpoints still consider them unattached. Deletion can make
    persistence fail after a paid completion. The image path can also delete the bucket object while leaving an attached database row. Requested uploads need a reservation
    before starting the model.

  - [P2] Provider work can outlive the conversation claim. The claim expires after 10 minutes at backend/api/src/data/conversations.data.ts:68, but chatAI sets no timeout
    or retry limit. The installed OpenRouter SDK defaults to retrying 5xx responses for up to one hour at backend/node_modules/@openrouter/sdk/esm/funcs/chatSend.js:46.
    Another request can take the expired claim, causing the original paid completion to fail persistence. First turns are worse because persistence also waits for the
    nonessential title request at backend/api/src/controllers/messages.controller.ts:506. Provider timeout and retry budgets must stay below the claim lease. Title
    generation should have a short fallback deadline.

  - [P2] Transcript validation and history admission use different snapshots. backend/api/src/controllers/messages.controller.ts:363 run as separate concurrent queries. If
    a transcript finishes between their snapshots, the history query sees it as missing and returns no history at backend/api/src/data/messages.data.ts:245, while
    findTranscripts sees it and the handler accepts the request. The model then receives the transcript but silently loses all conversation history. Both results should
    come from one SQL snapshot, with an explicit missing or oversized status.

  - [P2] Transcript attachment count is unlimited. The schema caps only imageCount at backend/api/src/schema/messages.schema.ts:75. An authenticated request can contain
    thousands of unique transcript IDs. The handler puts them into two SQL IN lists and reads every matching body before rejecting an oversized prompt. This can produce
    huge queries or exceed PostgreSQL parameter limits. Add a total attachment cap or a separate transcript cap.

  - [P3] History images are signed before confirming the model accepts them. backend/api/src/data/messages.data.ts:318 signs admitted history images before the capability
    check at backend/api/src/controllers/messages.controller.ts:461. With a text-only model, expired history images cause unnecessary storage calls. A storage failure
    returns 500 before the intended 400 model-validation response.