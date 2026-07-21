alias sandcc='sbx run --name summarizer'
alias sand='sbx exec -it summarizer bash'



alias sand_ports='sbx ports summarizer --publish 5173:5173 && sbx ports summarizer --publish 3001:3001 && sbx ports summarizer --publish 4000:4000'
