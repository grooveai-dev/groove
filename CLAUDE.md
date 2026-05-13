# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# GROOVE — Agent Orchestration Layer

> Spawn fast. Stay aware. Never lose context.

## Build & Development Commands

```bash
# Build GUI (required after any GUI changes — daemon serves built assets)
npm run build                    # or: cd packages/gui && npx vite build

# Run all tests (265 tests, 24 suites)
npm test                         # or: node --test packages/daemon/test/*.test.js

# Run a single test file
node --test packages/daemon/test/registry.test.js

# Dev servers (not for agents — agents use npm run build)
npm run dev:gui                  # Vite dev server (HMR)
npm run dev:daemon               # Daemon in dev mode
```

**Important:** GUI changes require `npm run build` to take effect (daemon serves static build from `packages/gui/dist/`). Daemon changes require a manual daemon restart — agents must NEVER restart the daemon themselves.

## What This Is

GROOVE is a lightweight, open-source agent orchestration layer for AI coding tools. It is a **process manager** — it spawns, coordinates, and monitors AI coding agents. It does NOT wrap, proxy, or impersonate any AI API.

## Architecture

```
groove/
├── packages/
│   ├── daemon/     — Node.js daemon (port 31415) — the brain
│   ├── cli/        — `groove` CLI commands (21+ commands)
│   └── gui/        — React + Vite GUI (served by daemon on :31415)
├── CLAUDE.md       — this file
├── README.md       — public docs
└── LICENSE         — FSL-1.1-Apache-2.0
```

### Daemon Components (packages/daemon/src/)

**Core:**
- **Index** (`index.js`) — daemon entry point, component initialization, WebSocket server, lifecycle management
- **Registry** (`registry.js`) — in-memory agent state store, EventEmitter, prototype-pollution-safe updates
- **API** (`api.js`) — 50+ REST endpoints + WebSocket broadcasts, CORS restricted to localhost, input validation
- **ProcessManager** (`process.js`) — spawn/kill agent processes, stdout capture, phase 2 auto-spawn, session resume, timeline events
- **PM** (`pm.js`) — process manager utilities
- **StateManager** (`state.js`) — persist/recover state across daemon restarts
- **Validate** (`validate.js`) — centralized input validation (agent config, scope patterns, team names, markdown escaping)
- **FirstRun** (`firstrun.js`) — first-run detection, provider scan, config initialization
- **MimeTypes** (`mimetypes.js`) — MIME type lookup utilities

**Coordination:**
- **Introducer** (`introducer.js`) — generates AGENTS_REGISTRY.md, injects GROOVE section into CLAUDE.md, team context + Project Memory (Layer 7) injection for new agents
- **LockManager** (`lockmanager.js`) — file scope ownership via glob patterns, coordination operations (enforced knock protocol, 10-min TTL), conflict detection with minimatch
- **Supervisor** (`supervisor.js`) — QC approval routing, conflict recording, GROOVE_CONFLICTS.md, auto-QC at 4+ agents
- **Teams** (`teams.js`) — live organizational groups (CRUD), auto-migration of legacy agents, backward compat stubs

**Intelligence:**
- **Journalist** (`journalist.js`) — AI-powered context synthesis (headless claude -p), log filtering (stream-json parsing), GROOVE_PROJECT_MAP.md, GROOVE_DECISIONS.md, per-agent session logs, handoff brief generation (prepends last 3 rotations from memory), reserved-ID token tracking for synthesis overhead
- **Rotator** (`rotator.js`) — context rotation engine (kill + respawn with fresh context), adaptive threshold + quality + safety triggers (token ceiling, velocity spike), 5-min cooldown, pre/post velocity measurement, appends brief to persistent chain, updates specializations
- **Adaptive** (`adaptive.js`) — per-provider per-role rotation thresholds, session scoring 0-100, threshold adjustment (+2%/-5%), convergence detection (used to gate quality rotations)
- **TokenTracker** (`tokentracker.js`) — per-agent token accounting, session metrics (duration/turns/cost), corrected cache hit rate, velocity + windowed-tokens queries, internal overhead segregation, savings calculator
- **Classifier** (`classifier.js`) — task complexity classification (light/medium/heavy) via sliding window, broadcasts mid-session updates every 20 events for downshift suggestions
- **Router** (`router.js`) — adaptive model routing (Fixed/Auto/Auto-with-floor modes), cost tracking, downshift suggestion API (never auto-applied, requires user click)
- **Memory** (`memory.js`) — **Layer 7** persistent agent memory: project-constraints.md, handoff-chain/<role>.md (last 10 per role), agent-discoveries.jsonl (error→fix pairs, dedup), agent-specializations.json (per-agent + per-role quality profiles)
- **Timeline** (`timeline.js`) — historical metrics snapshots (30s intervals, max 2K), lifecycle events (spawn/complete/crash/kill/rotate with reason, max 500)

**Services:**
- **Skills** (`skills.js`) — skill marketplace management, API integration, local cache, auth tokens
- **Integrations** (`integrations.js`) — MCP integrations (Slack, Gmail, Stripe, etc.)
- **Scheduler** (`scheduler.js`) — cron scheduling for agents
- **Indexer** (`indexer.js`) — code/file indexing
- **FileWatcher** (`filewatcher.js`) — file system monitoring
- **Audit** (`audit.js`) — append-only audit log of state-changing operations
- **Federation** (`federation.js`) — daemon-to-daemon federation/pairing over Tailscale mesh
- **TerminalPTY** (`terminal-pty.js`) — PTY terminal management for GUI terminal

**Credentials:**
- **CredentialStore** (`credentials.js`) — AES-256-GCM encrypted API key storage, machine-specific key derivation, 0o600 file permissions

### Providers (packages/daemon/src/providers/)

Each provider implements: `isInstalled()`, `buildSpawnCommand()`, `buildHeadlessCommand()`, `parseOutput()`.
Provider registry in `index.js`. Base interface in `base.js`.

| Provider | File | Auth | Models | Hot-Swap | Extras |
|----------|------|------|--------|----------|--------|
| Claude Code | `claude-code.js` | Subscription | Opus/Sonnet/Haiku | Yes | Session resume, cache tracking |
| Codex | `codex.js` | API Key | o3/o4-mini | No | Cost estimation |
| Gemini CLI | `gemini.js` | API Key | Pro/Flash | No | Cost estimation, YOLO mode |
| Ollama | `ollama.js` | Local | Any | No | Hardware reqs, installed model scan |

### Terminal Adapters (packages/daemon/src/terminal/)

- `base.js` — interface
- `generic.js` — fallback (background processes)
- `tmux.js` — tmux pane management (execFileSync, paneId validation)

### Team Templates (packages/daemon/templates/)

Bundled starter teams: `fullstack.json`, `api-builder.json`, `monorepo.json`

## Tech Stack

- Node.js 20+ (ESM, `"type": "module"`)
- npm workspaces (monorepo)
- Express + ws (daemon, bound to 127.0.0.1)
- React 19 + Vite 6 (GUI)
- Tailwind CSS v4 + Radix UI (GUI styling + accessible primitives)
- Zustand 5 (GUI state + WebSocket sync)
- React Flow / @xyflow/react (agent tree visualization)
- CodeMirror 6 + @uiw/codemirror-themes-all (code editor, 7 languages, 38 selectable themes)
- xterm.js (terminal emulation)
- Framer Motion (animations)
- Lucide React (icons)
- Inter + JetBrains Mono via @fontsource (typography)
- commander + chalk (CLI)
- AES-256-GCM + scrypt (credential encryption)

## CLI Commands

```
groove start              — start daemon (first-run wizard on first use)
groove stop               — stop daemon
groove spawn --role <r>   — spawn an agent
groove kill <id>          — kill an agent
groove agents             — list agents
groove status             — daemon status
groove nuke               — kill all + stop
groove rotate <id>        — context rotation (kill + respawn with handoff brief)
groove team create <name> — create a new team
groove team rename <id>   — rename a team
groove team list          — list teams
groove team delete <id>   — delete a team
groove team save <name>   — alias for team create (backward compat)
groove team load <name>   — [deprecated] — shows migration message
groove team export <name> — [deprecated] — shows migration message
groove team import <file> — [deprecated] — shows migration message
groove providers          — list available AI providers
groove set-key <p> <key>  — set API key for a provider
groove config show        — show configuration
groove config set <k> <v> — set a config value
groove approvals          — list pending approvals
groove approve <id>       — approve a request
groove reject <id>        — reject a request
groove connect <target>   — SSH tunnel to remote daemon
groove disconnect         — disconnect from remote daemon
groove audit              — view audit log
groove federation pair    — pair with remote daemon
groove federation unpair  — unpair remote daemon
groove federation list    — list federation peers
groove federation status  — federation status
```

## API Endpoints

All endpoints on `http://localhost:31415/api/`. CORS restricted to localhost. 50+ endpoints total.

| Category | Methods | Paths | Description |
|----------|---------|-------|-------------|
| Health | GET | /api/health, /api/status | Health check, daemon status |
| Agents | GET/POST/DELETE | /api/agents, /api/agents/:id | Agent CRUD, detail, update |
| Agent Actions | POST | /api/agents/:id/rotate, instruct, query | Rotation, instructions, queries |
| Agent Routing | GET | /api/agents/:id/routing/recommend | Model routing recommendations |
| Teams | GET/POST | /api/teams | List, create teams |
| Teams | PATCH/DELETE | /api/teams/:id | Rename, delete teams |
| Credentials | GET/POST/DELETE | /api/credentials, /api/credentials/:provider | API key management |
| Auth | GET/POST | /api/auth/* | Login URL, callback, status, validate, logout, purchases |
| Providers | GET | /api/providers | Provider listing |
| Config | GET/PATCH | /api/config | Configuration |
| Tokens | GET | /api/tokens/summary | Token usage + savings |
| Approvals | GET/POST | /api/approvals, /api/approvals/:id/* | Approval queue, approve/reject |
| Skills | GET/POST/DELETE | /api/skills/* | Registry, installed, install, rate, import, content |
| Integrations | GET/POST | /api/integrations/* | Registry, installed, authenticate, install, OAuth |
| Journalist | GET/POST | /api/journalist, /api/journalist/* | Status, query, cycle |
| Rotation | GET | /api/rotation | Rotation stats |
| Routing | GET | /api/routing | Model routing status |
| Adaptive | GET | /api/adaptive | Adaptive threshold config |
| Locks | GET | /api/locks | File lock status |

## GUI (packages/gui/)

React app served by daemon at `http://localhost:31415`. VS Code-style layout. Tailwind CSS v4, zero inline styles.

**Layout (components/layout/):**
- **AppShell** — main layout container with resizable panels
- **ActivityBar** — 48px left rail, 5 nav + 2 utility icons
- **BreadcrumbBar** — logo, Cmd+K search, breadcrumbs, pill spawn button
- **DetailPanel** — resizable right sidebar (agent panel, journalist panel)
- **TerminalPanel** — bottom terminal with resize/fullscreen
- **StatusBar** — connection, agent count, terminal toggle
- **CommandPalette** — Cmd+K fuzzy search, dynamic agent commands

**Views (src/views/):**
- **Agents** — React Flow tree, slim 200px nodes, animated edges, minimap, welcome onboarding
- **Dashboard** — KPI strip with sparklines, token/cost chart, fleet panel, savings, activity feed
- **Editor** — CodeMirror 6 (7 languages), file tree, tabs, media viewer, terminal
- **Marketplace** — NFT-style skill cards, category bar, search, ratings, integrations tab
- **Teams** — team management, approvals, schedules as sub-tabs

**Agent Components (components/agents/, 14 files):**
- AgentNode, RootNode, AgentPanel, AgentChat, AgentStats, AgentActions, AgentConfig, AgentFeed, AgentTelemetry, SpawnWizard, ContextGauge, FolderBrowser, JournalistPanel, NodeContextMenu

**UI Primitives (components/ui/, 17 files):**
- Button, Badge, Input, Select, Dialog, Sheet, Tabs, Tooltip, DropdownMenu, ScrollArea, Card, Skeleton, StatusDot, Avatar, ContextMenu, Toast, Collapsible

**State:** Zustand store (stores/groove.js) — agents, teams, navigation, layout, editor, chat, approvals, marketplace, WebSocket
**Utilities:** lib/ — cn (classnames), status (colors), format (numbers/time), theme-hex, api (fetch wrapper), hooks (dashboard, keyboard, media-query, toast)

## Security

- Server bound to `127.0.0.1` only (not network-accessible)
- CORS restricted to localhost origins
- WebSocket origin verification
- AES-256-GCM credential encryption with machine-specific key derivation
- Input validation on all API endpoints (role, name, scope, prompt)
- Prototype pollution protection (whitelisted keys on Object.assign)
- Log files created with 0o600 permissions
- Command injection prevention (execFileSync with array args in tmux)
- Scope patterns validated (no absolute paths, no traversal)
- 265 automated tests across 24 suites

## Conventions

- All files use ESM (`import`/`export`)
- License header on every source file: `// FSL-1.1-Apache-2.0 — see LICENSE`
- Port 31415 for daemon (REST + WebSocket + GUI)
- `.groove/` directory in project root for runtime state (gitignored)
- Generated markdown files: `AGENTS_REGISTRY.md`, `GROOVE_PROJECT_MAP.md`, `GROOVE_DECISIONS.md`

## GUI Styling Rules

- **Tailwind CSS v4 only** — zero inline styles (no `style={{}}` except dynamic values like `width`, `height`)
- **No absolute-positioned floating buttons** over content — use flex layout rails instead
- **File tree icons** must be neutral/muted (`text-text-2`/`text-text-3`) — no rainbow colors
- **Editor themes** are user-selectable via status bar picker — do not hardcode syntax highlight colors
- **Font sizes:** file trees use `text-xs` (12px), editor uses 12px via theme
- **No inline styles for colors** — use design token CSS variables (`--color-accent`, `--color-danger`, etc.)

## Compliance (CRITICAL)

GROOVE is a process manager, NOT a harness. Hard rules:
1. **Never touch OAuth tokens** — each `claude` process manages its own auth
2. **Never impersonate Claude Code** — GROOVE doesn't send HTTP requests to Anthropic
3. **Never proxy API calls** — all AI requests flow directly from provider CLI to provider servers
4. **The Journalist uses API key auth** for headless `claude -p` calls
5. **One subscription = one user** — never share subscriptions

## Distribution

- **npm:** `npm i -g groove-dev` (published as `groove-dev`)
- **GitHub:** `github.com/grooveai-dev/groove`
- **Website:** groovedev.ai
- **Docs:** docs.groovedev.ai

## Current Status (v0.27.0)

Audit-driven release. Multi-agent orchestration system with 7 coordination layers: Journalist, Introducer/Knock Protocol, Rotator, Adaptive Thresholds, Token Tracker, Router/Classifier, and Persistent Agent Memory (new).

**Key capabilities:**
- GUI v2: VS Code-style layout, Tailwind CSS v4, Radix UI, zero inline styles
- Agent tree: React Flow with 200px slim nodes, animated edges, minimap, welcome onboarding
- Agent panel: chat (bubble UI, mode pills), stats (canvas charts), controls (model swap, rotate, kill)
- Marketplace: NFT-style skill cards, integrations, search, ratings
- Editor: CodeMirror 6, file tree, terminal (xterm.js)
- Dashboard: KPI sparklines, token/cost charts, fleet panel, savings breakdown, per-team burn panel
- Quick Launch: planner recommends team, one-click spawns all agents
- Chat continuation: reply to completed agents, streaming text, markdown rendering
- Context chain: planner output flows automatically to builders
- Journalist: zero cold-start, synthesis on completion, 40K char budget, synthesis tokens now tracked
- Infinite Sessions: adaptive rotation, degradation detection, 5-min cooldown, converged-profile awareness
- Token tracking: wired end-to-end, session metrics, cache-corrected hit rate, internal overhead segregated from user agents
- Timeline: historical metrics snapshots, lifecycle events
- Teams: live organizational groups with CRUD operations, per-team burn tracking
- Coordination: enforced knock protocol via HTTP, task negotiation, scope locks
- Safety: auto-rotate on token ceiling (5M) or velocity spike (1.5M/5min), scoped to agent instance
- Persistent Memory (Layer 7): project constraints, handoff chains, error→fix discoveries, per-agent specializations — agent #50 knows what agent #1 learned
- Mid-session classification: surfaces downshift suggestions, never silently downshifts
- Federation: daemon-to-daemon pairing over Tailscale mesh
- Scheduling: cron-based agent scheduling
- Audit: append-only operation logging

**Next steps:**
- GUI: memory view (constraints/chains/discoveries tabs)
- GUI: downshift suggestion pill in agent panel
- Stress test: reproduce 275M burn with v0.27 to measure real improvements
- Terminal multi-tab support
- Marketplace detail modal for integrations
- Dashboard: routing donut, cache panel, context health gauges
- Monitor/QC agent mode (stay active, loop)
- Distribution: demo video, HN launch, Twitter content

<!-- GROOVE:START -->
## GROOVE Orchestration (auto-injected)
Active agents: 0
See AGENTS_REGISTRY.md for full agent state.
**Memory policy:** GROOVE manages project memory automatically. Do not read or write MEMORY.md or .groove/memory/ files directly.
<!-- GROOVE:END -->
