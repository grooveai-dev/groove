# GROOVE

**Orchestrate your AI coding agents. Stop losing context.**

The open-source orchestration layer for AI coding tools. Spawn teams of agents, coordinate their work, and never lose context — with a full GUI dashboard.

[![npm](https://img.shields.io/npm/v/groove-dev)](https://www.npmjs.com/package/groove-dev)
[![License](https://img.shields.io/badge/license-FSL--1.1--Apache--2.0-blue)](LICENSE)

```bash
npm i -g groove-dev
groove start
```

Open `http://localhost:31415` — your command center is ready.

---

## The Problem

AI coding agents waste your money and lose their way:

- **Cold starts** — every new agent spends thousands of tokens re-learning your codebase
- **Context degradation** — long sessions lead to hallucinations, circular refactors, lost direction
- **No coordination** — multiple agents edit the same files, create conflicts, duplicate work
- **Blind spending** — no visibility into token usage, no way to optimize costs

## The Solution

GROOVE sits between you and your AI coding agents. It doesn't replace them — it makes them work together.

### Zero Cold-Start (The Journalist)

A background AI continuously watches all agent activity and synthesizes it into a living project map. When any agent spawns or restarts, it reads one file and knows everything. No re-explaining your codebase. No wasted tokens on orientation.

### Infinite Sessions (Context Rotation)

Instead of letting agents fill their context window until they degrade, GROOVE detects quality decline — error spikes, circular refactors, file churn — and automatically rotates: kill the session, spawn fresh, feed it the Journalist's context. The agent picks up exactly where it left off with a clean window. No compaction. No drift. Works at any codebase scale.

### AI Project Manager

Agents in Auto mode knock on the PM before risky operations (creating files, deleting, modifying config). The PM reviews against the project plan and scope rules, then approves or rejects with reasoning. Full audit trail in the GUI.

### Quick Launch

Spawn a planner, describe your project. The planner writes a detailed plan and recommends a team. Click **Launch Team** — all agents spawn with proper roles, scopes, and prompts. One click from idea to a full team building your app.

### Multi-Agent Coordination

- **Introduction protocol** — every agent knows its teammates, their files, and their work
- **Scope ownership** — agents stay in their lane (backend touches `src/api/**`, frontend owns `src/components/**`)
- **Task negotiation** — duplicate roles get assigned non-overlapping work
- **Knock protocol** — agents signal before shared/destructive actions

## Works With Everything

| Provider | Auth | Models |
|----------|------|--------|
| **Claude Code** | Subscription | Opus, Sonnet, Haiku |
| **Codex** | API Key | o3, o4-mini |
| **Gemini CLI** | API Key | 2.5 Pro, 2.5 Flash |

| **Ollama** | Local | Any |

GROOVE is a process manager — it spawns actual AI tool binaries. It never proxies API calls, never touches OAuth tokens, never impersonates any client. Your AI tools talk directly to their servers.

Works in any terminal, any IDE, any OS. Technical and non-technical users alike.

## The GUI

Open `http://localhost:31415` after starting the daemon:

- **Agent Tree** — visual node graph with Bezier spline connections, role badges, live status
- **Chat** — instruct agents, query without disrupting, continue completed agents, streaming text
- **Command Center** — gauge charts, live telemetry, token savings, model routing, adaptive thresholds
- **Quick Launch** — planner recommends team, one-click to spawn all
- **PM Review Log** — full audit trail of AI Project Manager decisions
- **Team Management** — save, load, export, import agent configurations

## Adaptive Model Routing

GROOVE routes tasks to the cheapest model that can handle them. Planners get Opus (deep reasoning). Backends get Sonnet (balanced). Docs get Haiku (fast and cheap). The classifier learns from agent activity and adjusts over time.

| Tier | Cost | Used For |
|------|------|----------|
| Heavy (Opus) | $0.045/1K | Planning, architecture, complex refactors |
| Medium (Sonnet) | $0.009/1K | Backend, frontend, testing |
| Light (Haiku) | $0.002/1K | Docs, synthesis, simple queries |

## Architecture

```
         ┌─────────────────────────────────────────┐
         │            GROOVE DAEMON (:31415)        │
         │                                         │
         │  Registry · Introducer · Lock Manager   │
         │  Journalist · Rotator · Adaptive        │
         │  Classifier · Router · PM · Teams       │
         │                                         │
         │  REST API · WebSocket · GUI Server       │
         └─────────────────┬───────────────────────┘
                           │
    ┌──────────────────────▼──────────────────────┐
    │  Claude Code · Codex · Gemini · Ollama           │
    └─────────────────────────────────────────────┘
```

## Links

- **Website:** [groovedev.ai](https://groovedev.ai)
- **Documentation:** [docs.groovedev.ai](https://docs.groovedev.ai)
- **Changelog:** [docs.groovedev.ai/changelog](https://docs.groovedev.ai/changelog)
- **GitHub:** [github.com/grooveai-dev/groove](https://github.com/grooveai-dev/groove)
- **npm:** [npmjs.com/package/groove-dev](https://www.npmjs.com/package/groove-dev)
- **License:** [FSL-1.1-Apache-2.0](LICENSE) — source-available, converts to Apache 2.0 after 2 years
