FROM docker.io/docker/sandbox-templates:codex-docker

ARG OPENAI_SKILLS_COMMIT=49f948faa9258a0c61caceaf225e179651397431
ARG PLAYWRIGHT_CLI_VERSION=0.1.18

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

USER root

RUN npm install --global "@playwright/cli@${PLAYWRIGHT_CLI_VERSION}" \
    && playwright-cli install-browser chromium --with-deps \
    && chmod -R a+rX "${PLAYWRIGHT_BROWSERS_PATH}" \
    && rm -rf /var/lib/apt/lists/*

RUN git init /tmp/openai-skills \
    && git -C /tmp/openai-skills remote add origin https://github.com/openai/skills.git \
    && git -C /tmp/openai-skills config core.sparseCheckout true \
    && mkdir -p /tmp/openai-skills/.git/info \
    && printf 'skills/.curated/playwright/\n' > /tmp/openai-skills/.git/info/sparse-checkout \
    && git -C /tmp/openai-skills fetch --depth 1 origin "${OPENAI_SKILLS_COMMIT}" \
    && git -C /tmp/openai-skills checkout FETCH_HEAD \
    && mkdir -p /home/agent/.codex/skills \
    && cp -R /tmp/openai-skills/skills/.curated/playwright /home/agent/.codex/skills/playwright \
    && chown -R agent:agent /home/agent/.codex \
    && rm -rf /tmp/openai-skills

USER agent
