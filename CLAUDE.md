# GROOVE — Agent Orchestration Layer

> Spawn fast. Stay aware. Never lose context.

## What This Is

GROOVE is a lightweight, open-source agent orchestration layer for AI coding tools. It is a **process manager** — it spawns, coordinates, and monitors AI coding agents. It does NOT wrap, proxy, or impersonate any AI API.

## Architecture

```
groove/
├── packages/
│   ├── daemon/     — Node.js daemon (port 31415) — the brain
│   ├── cli/        — `groove` CLI commands (17 commands)
│   └── gui/        — React + Vite GUI (served by daemon on :31415)
├── CLAUDE.md       — this file
├── README.md       — public docs
└── LICENSE         — FSL-1.1-Apache-2.0
```

### Daemon Components (packages/daemon/src/)

**Core:**
- **Registry** (`registry.js`) — in-memory agent state store, EventEmitter, prototype-pollution-safe updates
- **API** (`api.js`) — REST endpoints + WebSocket broadcasts, CORS restricted to localhost, input validation
- **ProcessManager** (`process.js`) — spawn/kill agent processes, stdout capture, log file permissions 0o600
- **StateManager** (`state.js`) — persist/recover state across daemon restarts
- **Validate** (`validate.js`) — centralized input validation (agent config, scope patterns, team names, markdown escaping)
- **FirstRun** (`firstrun.js`) — first-run detection, provider scan, config initialization

**Coordination:**
- **Introducer** (`introducer.js`) — generates AGENTS_REGISTRY.md, injects GROOVE section into CLAUDE.md, team context for new agents
- **LockManager** (`lockmanager.js`) — file scope ownership via glob patterns, conflict detection with minimatch
- **Supervisor** (`supervisor.js`) — QC approval routing, conflict recording, GROOVE_CONFLICTS.md, auto-QC at 4+ agents
- **Teams** (`teams.js`) — save/load/import/export agent configurations, auto-save on changes

**Intelligence:**
- **Journalist** (`journalist.js`) — AI-powered context synthesis (headless claude -p), log filtering (stream-json parsing), GROOVE_PROJECT_MAP.md, GROOVE_DECISIONS.md, per-agent session logs, handoff brief generation
- **Rotator** (`rotator.js`) — context rotation engine (kill + respawn with fresh context), auto-rotation at adaptive threshold, rotation history
- **Adaptive** (`adaptive.js`) — per-provider per-role rotation thresholds, session scoring 0-100, threshold adjustment (+2%/-5%), convergence detection
- **TokenTracker** (`tokentracker.js`) — per-agent token accounting, savings calculator (rotation/conflict/cold-start savings)
- **Classifier** (`classifier.js`) — task complexity classification (light/medium/heavy) via sliding window pattern matching
- **Router** (`router.js`) — adaptive model routing (Fixed/Auto/Auto-with-floor modes), cost tracking

**Credentials:**
- **CredentialStore** (`credentials.js`) — AES-256-GCM encrypted API key storage, machine-specific key derivation, 0o600 file permissions

### Providers (packages/daemon/src/providers/)

Each provider implements: `isInstalled()`, `buildSpawnCommand()`, `buildHeadlessCommand()`, `parseOutput()`.

| Provider | File | Auth | Models | Hot-Swap |
|----------|------|------|--------|----------|
| Claude Code | `claude-code.js` | Subscription | Opus/Sonnet/Haiku | Yes |
| Codex | `codex.js` | API Key | o3/o4-mini | No |
| Gemini CLI | `gemini.js` | API Key | Pro/Flash | No |

| Ollama | `ollama.js` | Local | Any | No |

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
- Zustand (GUI state + WebSocket sync)
- React Flow / @xyflow/react (agent tree visualization)
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
groove team save <name>   — save current agents as a team
groove team load <name>   — load and spawn a saved team
groove team list          — list saved teams
groove team delete <name> — delete a team
groove team export <name> — export team as JSON
groove team import <file> — import team from JSON
groove providers          — list available AI providers
groove set-key <p> <key>  — set API key for a provider
groove config show        — show configuration
groove config set <k> <v> — set a config value
groove approvals          — list pending approvals
groove approve <id>       — approve a request
groove reject <id>        — reject a request
```

## API Endpoints

All endpoints on `http://localhost:31415/api/`. CORS restricted to localhost.

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Health check |
| GET/POST/DELETE | /api/agents | Agent CRUD |
| POST | /api/agents/:id/rotate | Context rotation |
| GET/POST/DELETE | /api/teams | Team management |
| GET/POST/DELETE | /api/credentials | API key management |
| GET | /api/providers | Provider listing |
| GET/PATCH | /api/config | Configuration |
| GET | /api/tokens/summary | Token usage + savings |
| GET/POST | /api/approvals | Approval queue |
| GET | /api/journalist | Journalist status |
| GET | /api/rotation | Rotation stats |
| GET | /api/routing | Model routing status |

## GUI (packages/gui/)

React app served by daemon at `http://localhost:31415`:
- **AgentTree** — React Flow visualization, click-to-select, animated edges for running agents
- **SpawnModal** — role presets, dynamic provider/model selector
- **AgentDetail** — sidebar with info, activity log, context bar, rotate/kill buttons
- **JournalistFeed** — synthesis results, history, manual trigger
- **TokenDashboard** — usage stats, savings breakdown
- **ApprovalQueue** — pending approvals with approve/reject
- **TeamSelector** — save/load/delete teams from header dropdown
- **Notifications** — toast system for events

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
- 137 automated tests across 14 suites

## Conventions

- All files use ESM (`import`/`export`)
- License header on every source file: `// FSL-1.1-Apache-2.0 — see LICENSE`
- Port 31415 for daemon (REST + WebSocket + GUI)
- `.groove/` directory in project root for runtime state (gitignored)
- Generated markdown files: `AGENTS_REGISTRY.md`, `GROOVE_PROJECT_MAP.md`, `GROOVE_DECISIONS.md`

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

## Current Status (v0.7.1)

Fully functional multi-agent orchestration system. Tested end-to-end: planner → Quick Launch → 4 agents → working app.

**Key capabilities:**
- Quick Launch: planner recommends team, one-click spawns all agents
- AI Project Manager: reviews risky operations in Auto permission mode
- Chat continuation: reply to completed agents, streaming text, markdown rendering
- Context chain: planner output flows automatically to builders
- Journalist: zero cold-start, synthesis on completion, 40K char budget
- Infinite Sessions: adaptive rotation, degradation detection (file churn, error trends)
- Token tracking: wired end-to-end, savings data real
- Unity-style nodes: rounded, Bezier spline connections, role badges
- Command Center: gauge charts, live telemetry, persistent across tab switches
- Coordination: knock protocol, task negotiation, memory containment

**Next steps:**
- Dashboard polish (Grafana-level wow factor)
- Monitor/QC agent mode (stay active, loop)
- Remote access (--host 0.0.0.0 + token auth)
- Semantic degradation detection
- Distribution: demo video, HN launch, Twitter content
