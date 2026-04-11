#!/bin/bash
# GROOVE — Build, verify, and promote local changes to global install
# Usage: ./promote.sh
set -e

PROJECT="$(cd "$(dirname "$0")" && pwd)"
STAGING_PORT=31416
cd "$PROJECT"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

step() { echo -e "\n${GREEN}── $1 ──${RESET}"; }
warn() { echo -e "${YELLOW}$1${RESET}"; }
fail() { echo -e "${RED}$1${RESET}"; exit 1; }

# Cleanup staging daemon on abort (Ctrl+C)
STAGING_PID=""
cleanup() {
  if [ -n "$STAGING_PID" ]; then
    kill $STAGING_PID 2>/dev/null || true
  fi
  echo -e "\n${YELLOW}Aborted — nothing changed${RESET}"
  exit 0
}
trap cleanup INT

# ── Pre-flight ────────────────────────────────────────────

step "Pre-flight"

# Check for uncommitted changes that aren't from agents
CURRENT_BRANCH=$(git branch --show-current)
echo -e "  Branch: ${DIM}${CURRENT_BRANCH}${RESET}"
echo -e "  Version: ${DIM}$(node -p "require('./package.json').version")${RESET}"

# ── Build GUI ─────────────────────────────────────────────

step "Build GUI"
(cd packages/gui && npx vite build)

# ── Run tests ─────────────────────────────────────────────

step "Run tests (141 expected)"
npm test
echo -e "  ${GREEN}All tests passed${RESET}"

# ── Staging daemon ────────────────────────────────────────

step "Staging daemon on :${STAGING_PORT}"

# Kill any existing staging daemon on that port
lsof -ti:$STAGING_PORT 2>/dev/null | xargs kill 2>/dev/null || true
sleep 0.5

# Ensure .groove/config.json exists so the first-run wizard doesn't trigger.
# The staging daemon runs from source, pointing at the same project directory.
if [ ! -f ".groove/config.json" ]; then
  mkdir -p .groove
  echo '{"version":"0.1.0","port":31415}' > .groove/config.json
  echo -e "  ${DIM}Created .groove/config.json (first-run skip)${RESET}"
fi

# Start staging daemon — redirect stdin so readline wizard can't block
node packages/cli/bin/groove.js start --port $STAGING_PORT </dev/null &
STAGING_PID=$!

# Wait for daemon to be ready
for i in {1..10}; do
  if curl -s "http://localhost:${STAGING_PORT}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! curl -s "http://localhost:${STAGING_PORT}/api/health" >/dev/null 2>&1; then
  kill $STAGING_PID 2>/dev/null || true
  fail "Staging daemon failed to start"
fi

echo ""
echo -e "  ${GREEN}Staging live:${RESET} http://localhost:${STAGING_PORT}"
echo ""
echo -e "  ${YELLOW}ENTER${RESET}  → promote (version bump + publish + restart)"
echo -e "  ${YELLOW}Ctrl+C${RESET} → abort (nothing changes)"
echo ""
read -r

# ── Cleanup staging ───────────────────────────────────────

kill $STAGING_PID 2>/dev/null || true
sleep 1

# ── Version bump ──────────────────────────────────────────

step "Promote"

npm version patch --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
echo -e "  Version: ${GREEN}v${VERSION}${RESET}"

# ── Commit + tag ──────────────────────────────────────────

step "Commit"
git add -A
git commit -m "v${VERSION}"
git tag "v${VERSION}"
echo -e "  Tagged: ${DIM}v${VERSION}${RESET}"

# ── Publish ───────────────────────────────────────────────

step "Publish to npm"
npm publish
echo -e "  ${GREEN}Published groove-dev@${VERSION}${RESET}"

# ── Update global install ────────────────────────────────

step "Update global install"
npm i -g groove-dev@latest
echo -e "  ${GREEN}Global updated${RESET}"

# ── Restart daemon ────────────────────────────────────────

step "Restart daemon"
groove stop 2>/dev/null || true
sleep 1
groove start

echo ""
echo -e "  ${GREEN}✓ Live: v${VERSION} on :31415${RESET}"
echo ""
