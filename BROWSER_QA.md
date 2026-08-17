# Browser QA

## One-time sandbox setup

Build and load the browser template on the host as described in [`.sbx/README.md`](.sbx/README.md), then start it with `sanda_browser`.

## Start a test session

Run the app and create a seven-day session for the dedicated `playwright-e2e` database user:

```sh
npm run dev
npm run browser:auth
```

In another shell, open an isolated browser session and load the generated cookie:

```sh
playwright-cli -s=summarizer-qa open http://localhost:5173
playwright-cli -s=summarizer-qa state-load output/playwright/auth-state.json
playwright-cli -s=summarizer-qa goto http://localhost:5173/app
```

Use `http://localhost:5173` consistently so the API, WebSocket, and session cookie share the same hostname. Use `playwright-cli show` to watch or take control of the session.

## Evidence and cleanup

Write screenshots, traces, and videos under `output/playwright/`, which is ignored by Git:

```sh
playwright-cli -s=summarizer-qa screenshot --filename=output/playwright/page.png
playwright-cli -s=summarizer-qa tracing-start
playwright-cli -s=summarizer-qa tracing-stop
playwright-cli -s=summarizer-qa close
```

This is live smoke testing: uploads, transcripts, and chat messages call the configured providers and can incur development usage.
