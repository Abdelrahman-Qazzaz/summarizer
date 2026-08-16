# Browser-enabled Codex sandbox

Build and load this template once on the host:

```sh
docker build -t summarizer-codex-playwright:v1 -f .sbx/Dockerfile .
docker save summarizer-codex-playwright:v1 -o /tmp/summarizer-codex-playwright-v1.tar
sbx template load /tmp/summarizer-codex-playwright-v1.tar
```

Then source `aliases.sh` and use:

```sh
sanda_browser
sand_browser
sand_browser_ports
```

The template takes Chromium from Microsoft's multi-architecture `playwright:v1.62.0-resolute` image, then adds `@playwright/cli@0.1.18` and the official OpenAI Playwright skill pinned at commit `49f948faa9258a0c61caceaf225e179651397431`. Docker Sandbox caches the result across sandbox recreation.
