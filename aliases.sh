alias sanda='sbx run --name summarizer'
alias sand='sbx exec -it summarizer bash'
alias sand_ports='sbx ports summarizer --publish 5173:5173 && sbx ports summarizer --publish 3001:3001 && sbx ports summarizer --publish 4000:4000'

alias sanda_browser='sbx run --name summarizer-browser --template summarizer-codex-playwright:v1'
alias sand_browser='sbx exec -it summarizer-browser bash'
alias sand_browser_ports='sbx ports summarizer-browser --publish 5173:5173 && sbx ports summarizer-browser --publish 3001:3001 && sbx ports summarizer-browser --publish 4000:4000'
