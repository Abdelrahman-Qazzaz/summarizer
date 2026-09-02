



Bigger, but not in the code: the model. Median time until the model sends its first word was 1.76 s, the largest remaining piece. The options are a faster model, or telling OpenRouter to prefer faster providers. That's a product call, and it needs measuring.

Small: expired image URLs. When old image URLs get re-signed, the route waits for the new URLs to be saved to the database before it continues. Not waiting would save ~300 ms, but only on those requests, and URLs last 7 days, so it's rare.

Already fast: the model check that runs when a message has images reads from a cache and takes 0.04 ms.





Two more problems I found

1. A stuck title can block saving the answer. On a new conversation, the route waits for the title (messages.controller.ts:537) before it saves the message. Generating the title is a separate model call, also with no timeout. If it hangs, the answer has already streamed to the user but never gets saved, and the conversation stays locked. The title already falls back to the message text when generation fails (messages.controller.ts:84), so a short timeout there just uses that fallback.
2. A long response can lose the lock anyway. The lock isn't renewed while the model streams. If model time plus title plus saving goes past 10 minutes, the save fails with Conversation turn claim was lost (backend/shared/data/messages.data.ts:783) and the answer is thrown away. With MAX_RESPONSE_TOKENS = 4_000 that's unlikely, but only a total time limit below 10 minutes actually rules it out.