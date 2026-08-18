alias sanda='sbx run --name summarizer'
alias sand='sbx exec -it summarizer bash'
# 3001 serves the API and the websocket; Socket.IO attaches to the same server.
alias sand_ports='sbx ports summarizer --publish 5173:5173 && sbx ports summarizer --publish 3001:3001'

alias sanda_browser='sbx run --name summarizer-browser --template summarizer-codex-playwright:v1'
alias sand_browser='sbx exec -it summarizer-browser bash'
alias sand_browser_ports='sbx ports summarizer-browser --publish 5173:5173 && sbx ports summarizer-browser --publish 3001:3001'

# Everything the stack has to reach, with the sandbox left on default-deny.
# Re-run after recreating a sandbox — the allow-list does not survive it.
#   runtime: upstash (redis), supabase (db + storage), cloudamqp, and the
#            deepgram / openrouter / workos APIs
#   fetcher: youtube.com resolves the video, googlevideo.com serves the media
#   build:   docker hub, npm and pypi, or `docker compose build` fails
# Inspect with `sbx policy ls`; `sbx policy log` shows what got blocked and why.
alias sand_policy='sbx policy allow network upstash.io,supabase.co,pooler.supabase.com,cloudamqp.com,api.deepgram.com,openrouter.ai,api.workos.com,youtube.com,googlevideo.com,registry.npmjs.org,registry-1.docker.io,auth.docker.io,production.cloudflare.docker.com,pypi.org,files.pythonhosted.org'
