#!/usr/bin/env bash
set -uo pipefail

# --- git identity (runner has none globally) -> needed for pull --rebase ---
git config --global user.email "jarvis-bot@users.noreply.github.com"
git config --global user.name  "Jarvis Bot"
git config --global rebase.autoStash true

node src/main.mjs
STATUS=$?

# --- persist state ---
if [[ -n "$(git status --porcelain data/)" ]]; then
  git add data/
  git commit -m "state: update seen listings [skip ci]" || true
  for attempt in 1 2 3 4 5; do
    git pull --rebase --autostash origin "${GITHUB_REF_NAME:-main}" && break
    sleep $((attempt * 3))
  done
  for attempt in 1 2 3 4 5; do
    git push origin "HEAD:${GITHUB_REF_NAME:-main}" && break
    sleep $((attempt * 3))
    git pull --rebase --autostash origin "${GITHUB_REF_NAME:-main}" || true
  done
fi

exit $STATUS
