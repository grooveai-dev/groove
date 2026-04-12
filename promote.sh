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
  rm -rf "$PROJECT/.groove-staging" 2>/dev/null || true
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

# Start staging daemon in an isolated groove dir so it doesn't kill the main daemon
STAGING_DIR="$PROJECT/.groove-staging"
mkdir -p "$STAGING_DIR"
cp .groove/config.json "$STAGING_DIR/config.json" 2>/dev/null || echo '{"version":"0.1.0"}' > "$STAGING_DIR/config.json"
GROOVE_DIR="$STAGING_DIR" node packages/cli/bin/groove.js start --port $STAGING_PORT </dev/null &
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
rm -rf "$STAGING_DIR" 2>/dev/null || true
sleep 1

# ── Version bump ──────────────────────────────────────────

step "Promote"

npm version patch --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
echo -e "  Version: ${GREEN}v${VERSION}${RESET}"

# ── Commit + tag ──────────────────────────────────────────

step "Commit"

# Stage tracked files + new source files (not runtime state)
# The whitelist .gitignore protects us, but explicit staging is safer
git add -u                          # updated tracked files
git add packages/ promote.sh        # new files in source dirs
git add .gitignore .npmignore package.json package-lock.json CLAUDE.md README.md CHANGELOG.md LICENSE 2>/dev/null

git diff --cached --stat
echo ""

git commit -m "v${VERSION}"
git tag "v${VERSION}"
echo -e "  Tagged: ${DIM}v${VERSION}${RESET}"

# ── Publish ───────────────────────────────────────────────

step "Publish to npm"
npm publish
echo -e "  ${GREEN}Published groove-dev@${VERSION}${RESET}"

# ── Update global install ────────────────────────────────

step "Update global install"
# Clear npm cache and retry until the exact version is installed
npm cache clean --force 2>/dev/null
for attempt in 1 2 3 4 5 6; do
  npm i -g "groove-dev@${VERSION}" --registry https://registry.npmjs.org 2>/dev/null
  INSTALLED=$(groove --version 2>/dev/null)
  if [ "$INSTALLED" = "$VERSION" ]; then
    break
  fi
  echo -e "  ${DIM}Registry syncing... got ${INSTALLED:-nothing}, want ${VERSION} (attempt ${attempt}/6)${RESET}"
  sleep 5
done

INSTALLED=$(groove --version 2>/dev/null)
if [ "$INSTALLED" != "$VERSION" ]; then
  echo -e "  ${RED}Warning: global install is ${INSTALLED}, expected ${VERSION}${RESET}"
  echo -e "  ${DIM}Run manually: npm cache clean --force && npm i -g groove-dev@${VERSION}${RESET}"
else
  echo -e "  ${GREEN}Global updated to ${VERSION}${RESET}"
fi

echo ""
echo -e "  ${GREEN}✓ v${VERSION} published and globally installed${RESET}"
echo ""
echo -e "  Restart your daemon to pick up the new version:"
echo -e "  ${DIM}Ctrl+C in your groove terminal, then: groove start${RESET}"
echo ""
