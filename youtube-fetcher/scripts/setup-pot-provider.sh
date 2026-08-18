#!/usr/bin/env bash
# YouTube's media servers require a proof-of-origin token. The yt-dlp plugin
# that requests one ships on PyPI (bgutil-ytdlp-pot-provider, in
# requirements.txt), but the code that actually mints the token is a Node
# project distributed only on GitHub — so it is built here rather than pinned
# as a dependency.
#
# The plugin looks for the built script at a fixed path under $HOME, which is
# why that location is not configurable below. Re-run this after recreating
# the machine or container the fetcher runs on; nothing else needs it.
#
#   ./scripts/setup-pot-provider.sh
#
# Requires node and git. Without it, metadata resolves and every download
# fails with "HTTP Error 403: Forbidden", which looks like a network fault.
set -euo pipefail

REPO="https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git"
HOME_DIR="${HOME}/bgutil-ytdlp-pot-provider"
BUILT="${HOME_DIR}/server/build/generate_once.js"

command -v node >/dev/null || { echo "node is required" >&2; exit 1; }
command -v git  >/dev/null || { echo "git is required"  >&2; exit 1; }

if [ -d "${HOME_DIR}/.git" ]; then
  echo "Updating $(basename "${HOME_DIR}")…"
  git -C "${HOME_DIR}" pull --ff-only --quiet
else
  echo "Cloning the token provider…"
  rm -rf "${HOME_DIR}"
  git clone --depth 1 --quiet "${REPO}" "${HOME_DIR}"
fi

echo "Building…"
cd "${HOME_DIR}/server"
npm install --no-audit --no-fund --silent
npx tsc

[ -f "${BUILT}" ] || { echo "build produced no ${BUILT}" >&2; exit 1; }
echo "Ready: ${BUILT}"
