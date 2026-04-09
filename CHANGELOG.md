# Changelog

## v0.19.6 — Settings redesign: single-page layout, fix process.cwd crash (2026-04-08)

- **Full redesign** — no more tabs, everything on one scrollable page with clear visual sections (icon headers, bordered cards, 2-col daemon grid)
- **Fix crash** — removed `process.cwd()` call that doesn't exist in browser context
- **Providers section** — expandable cards with status dots, model pills, API key management, Ollama setup inline
- **Configuration section** — all settings in a single bordered card with dividers, compact number inputs with suffix labels, slim toggle switches
- **Account section** — marketplace sign-in card, 2-column daemon info grid (version, port, host, PID, uptime, agents)
- **Footer** — groovedev.ai and docs links

## v0.19.5 — Settings page: providers, API keys, config, account (2026-04-08)

- **Settings view** — proper settings page with three tabs: Providers, Configuration, Account
- **Providers tab** — all providers with status badges, expandable cards, API key management (add/update/remove with masked display), Ollama setup inline with full model catalog
- **Configuration tab** — daemon settings with live save: default provider, working directory, auto-rotation toggle, rotation threshold, QC threshold, max agents, journalist interval
- **Account tab** — marketplace sign-in/out, user profile display, daemon info (version, port, host, PID, uptime)
- **Activity bar fix** — Settings gear icon now opens Settings view (was incorrectly pointing to Teams/Management)

## v0.19.4 — Ollama server lifecycle, UI state fix (2026-04-08)

- **Server detection** — checks if Ollama server is running (not just binary installed), shows "Start Ollama Server" button with auto-start via brew services or ollama serve
- **Three-state install flow** — not installed → installed but server down → ready with models
- **UI state fix** — closing/reopening Ollama dropdown no longer reverts to install screen; provider list refreshes on state change
- **New API endpoints** — `POST /api/providers/ollama/serve` (auto-start server), `/check` now returns `serverRunning` flag

## v0.19.3 — Ollama setup experience: hardware detection, model catalog, one-click pull (2026-04-08)

- **Ollama model catalog** — 22 models across Code and General categories with RAM requirements and download sizes
- **Hardware detection** — auto-detects RAM, CPU, GPU (Apple Silicon unified memory, NVIDIA), recommends best models for your system
- **Model management** — pull models from GUI with progress via WebSocket, delete installed models, category tabs (Code/General)
- **Install flow** — platform-specific install command (brew on macOS, curl on Linux), copy button, hardware readiness check, "Recheck" button
- **5 new API endpoints** — `/api/providers/ollama/hardware`, `/models`, `/pull`, `/check`, `DELETE /models/:model`

## v0.19.2 — Config tab cleanup, remove restart, fix Ollama key prompt (2026-04-08)

- **Remove restart button** — sending a chat message resumes with context, restart was redundant
- **Config tab reorder** — Active Model now at top, then actions (Rotate/Clone/Kill), then providers
- **Compact actions** — alive agents: 3-col grid (Rotate | Clone | Kill), dead: 2-col (Clone | Remove)
- **Fix Ollama** — no longer shows API key prompt for local providers, shows "Not installed" instead of "No key"

## v0.19.1 — Fix page load flicker, toast text alignment (2026-04-08)

- **Loading screen**: Show pulsing logo + "Connecting..." until first WebSocket state arrives — eliminates the 1-2s flash of empty welcome screen
- **Toast alignment**: Fixed vertical text alignment (was too high) — switched from `items-start` to `items-center`, removed icon margin

## v0.19.0 — GUI v2 complete rebuild, backend overhaul, tech debt cleanup (2026-04-08)

### GUI — Complete Rebuild
- **Rebuilt entire frontend from scratch** — 23 old files deleted, 59 new component files across 6 categories
- **Tailwind CSS v4** — zero inline styles, unified design token system (surface-*, text-*, border-*)
- **VS Code-style layout** — Activity Bar, Breadcrumb Bar, Status Bar, resizable Detail Panel, Terminal Panel
- **Command Palette** — Cmd+K fuzzy search with dynamic agent commands
- **Agent tree** — React Flow with 200px slim nodes, animated edges, minimap, welcome onboarding
- **Agent panel** — chat (bubble UI, mode pills), stats (canvas charts), controls (model swap, rotate, kill), telemetry, config
- **Marketplace** — NFT-style skill cards, category bar, search, ratings, integrations tab
- **Editor** — CodeMirror 6 (7 languages), file tree, tabs, media viewer
- **Terminal** — xterm.js integration with resize/fullscreen
- **Dashboard** — KPI sparklines, token/cost charts, fleet panel, savings breakdown, activity feed
- **Teams view** — team management, approvals, schedules as sub-tabs
- **UI primitives** — 17 Radix UI + Tailwind components (Button, Dialog, Tabs, Toast, etc.)
- **Utilities** — cn (classnames), status colors, formatters, API wrapper, custom hooks
- **New dependencies** — Tailwind CSS v4, Radix UI, Lucide React, Framer Motion, @fontsource (Inter, JetBrains Mono)

### Backend
- **Timeline** (`timeline.js`) — historical metrics snapshots (30s intervals), lifecycle events (spawn/complete/crash/kill/rotate)
- **Teams overhaul** — migrated from snapshot-based to live organizational groups with CRUD, auto-migration of legacy agents
- **Registry** — new SAFE_FIELDS: routingMode, routingReason, sessionId, teamId, effort, costUsd, durationMs, turns, inputTokens, outputTokens
- **Process manager** — phase 2 auto-spawn, session resume (Claude Code), timeline event recording
- **Rotator** — timeline integration, cumulative token carry across rotations
- **Token tracker** — session metrics (duration, turns, cost), format migration
- **Providers** — Claude Code session resume support, codex/gemini cost estimation
- **Skills** — expanded marketplace integration, local cache, auth token management

### CLI
- **Team commands** — `create` and `rename` added, `load/export/import` deprecated with helpful stubs
- **Version** — CLI version now matches package version (was stuck at 0.4.0)

### Tech Debt Cleanup
- Removed unused `cpSpawn` import from api.js
- Fixed provider `switchModel()` signature mismatch (codex/gemini/ollama now match base interface)
- Removed dead `injectContext()` method from base.js and claude-code.js
- Added auto-generated files to .gitignore (AGENTS_REGISTRY.md, GROOVE_*.md, GROOVE_AGENT_LOGS/)
- Updated CLAUDE.md — was at v0.7.1, now documents all 29 daemon files, 21+ CLI commands, 50+ API endpoints, full GUI v2

## v0.18.2 — Header redesign, phased QC, persistent nodes, smart edges (2026-04-08)

## v0.18.1 — Phased execution, agent naming, node redesign, global working dir (2026-04-07)

## v0.18.0 — Full-screen spawn panel, plan chat, effort selector, API key fast path (2026-04-06)

## v0.17.8 — Write gcp-oauth.keys.json for Google auto-auth MCP servers (2026-04-06)

## v0.17.7 — Fix authenticate: send MCP handshake to trigger OAuth (2026-04-06)

## v0.17.6 — Pre-authenticate auto-auth integrations (2026-04-06)

## v0.17.5 — Fix auto-auth integrations UX (installed vs connected) (2026-04-05)

## v0.17.4 — Fix route ordering + package names + auto-auth Google (2026-04-05)

## v0.17.3 — Fix Google OAuth UX: Connect button always visible (2026-04-05)

## v0.17.2 — Security: credentials never written to .mcp.json (2026-04-05)

## v0.17.1 — Guided setup wizard, Google OAuth flow (2026-04-05)

## v0.17.0 — Integrations, scheduling, business roles (2026-04-05)

## v0.16.4 — File editor, terminal, media viewer (2026-04-04)

## v0.15.1 — Skill ratings: interactive star widget + server proxy (2026-04-04)

## v0.15.0 — Skill injection: attach skills to agents at spawn or runtime (2026-04-04)
