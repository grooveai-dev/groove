# GROOVE — Agent Orchestration Layer

> Spawn fast. Stay aware. Never lose context.

## What This Is

GROOVE is a lightweight, open-source agent orchestration layer for AI coding tools. It is a **process manager** — it spawns, coordinates, and monitors AI coding agents. It does NOT wrap, proxy, or impersonate any AI API.

## Architecture

```
groove/
├── packages/
│   ├── daemon/     — Node.js daemon (port 3141) — the brain
│   ├── cli/        — `groove` CLI commands
│   └── gui/        — React + Vite GUI (served by daemon)
├── CLAUDE.md       — this file
└── LICENSE         — FSL-1.1-Apache-2.0
```

### Daemon Components

- **Registry** (`registry.js`) — in-memory agent state store, EventEmitter for changes
- **API** (`api.js`) — REST endpoints + WebSocket broadcasts
- **ProcessManager** (`process.js`) — spawn/kill agent processes, stdout capture
- **StateManager** (`state.js`) — persist/recover state across daemon restarts
- **Introducer** (`introducer.js`) — generates AGENTS_REGISTRY.md, injects team context
- **LockManager** (`lockmanager.js`) — file scope ownership, conflict detection
- **Supervisor** (`supervisor.js`) — QC approval routing
- **Journalist** (`journalist.js`) — background context synthesis engine
- **TokenTracker** (`tokentracker.js`) — per-agent token accounting

### Providers

Provider abstraction in `providers/base.js`. Each provider implements: `isInstalled()`, `buildSpawnCommand()`, `buildHeadlessCommand()`, `parseOutput()`.

Day 1: Claude Code (`providers/claude-code.js`). Future: Codex, Gemini, Aider, Ollama.

### Terminal Adapters

`terminal/base.js` — interface. `terminal/generic.js` — fallback (background processes).

## Tech Stack

- Node.js (ESM, `"type": "module"`)
- npm workspaces (monorepo)
- Express + ws (daemon server)
- React 19 + Vite 6 (GUI)
- Zustand (GUI state)
- React Flow / @xyflow/react (agent tree visualization)
- commander + chalk (CLI)

## Conventions

- All files use ESM (`import`/`export`)
- License header on every source file: `// FSL-1.1-Apache-2.0 — see LICENSE`
- Port 3141 for daemon (REST + WebSocket + GUI)
- `.groove/` directory in project root for runtime state (gitignored)
- Generated markdown files: `AGENTS_REGISTRY.md`, `GROOVE_PROJECT_MAP.md`, `GROOVE_DECISIONS.md`

## Compliance (CRITICAL)

GROOVE is a process manager, NOT a harness. Hard rules:
1. **Never touch OAuth tokens** — each `claude` process manages its own auth
2. **Never impersonate Claude Code** — GROOVE doesn't send HTTP requests to Anthropic
3. **Never proxy API calls** — all AI requests flow directly from provider CLI to provider servers
4. **The Journalist uses API key auth** for headless `claude -p` calls
5. **One subscription = one user** — never share subscriptions

## CLI Commands

```
groove start              — start daemon
groove stop               — stop daemon
groove spawn --role <r>   — spawn an agent
groove kill <id>          — kill an agent
groove agents             — list agents
groove status             — daemon status
groove nuke               — kill all + stop
```

## Build Phases

- **Phase 0** — Scaffolding (this) ✓
- **Phase 1** — Core daemon + CLI (working spawn/kill/coordinate)
- **Phase 2** — GUI (React Flow agent tree)
- **Phase 3** — Journalist + Context Rotation
- **Phase 4** — Teams (saved agent configs)
- **Phase 5** — Provider ecosystem + adaptive model routing
