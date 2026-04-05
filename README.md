# GROOVE

**Orchestrate your AI coding agents. Stop losing context.**

Coordinate multiple AI agents, eliminate cold-start, and save 40-60% on tokens.

[![npm](https://img.shields.io/npm/v/groove-ai)](https://www.npmjs.com/package/groove-ai)
[![License](https://img.shields.io/badge/license-FSL--1.1--Apache--2.0-blue)](LICENSE)

---

## Quick Start

```bash
npm i -g groove-ai
groove start
groove spawn --role backend --prompt "Build the auth API"
groove spawn --role frontend --prompt "Build the login page"
groove agents
```

## What GROOVE Does

GROOVE is a **process manager** for AI coding agents. It does not wrap or proxy any AI API — it spawns actual AI tool processes (`claude`, `codex`, `aider`, etc.) and adds:

- **Team awareness** — agents know about each other and their file scopes
- **File conflict prevention** — scoped ownership prevents agents from stepping on each other
- **The Journalist** — background AI that synthesizes what agents are doing into living documentation
- **Context rotation** — kills agents approaching context limits and respawns them with fresh context + handoff brief
- **Adaptive thresholds** — learns the optimal rotation point per provider, per role
- **Teams** — save/load agent configurations like Docker Compose for AI agents
- **Model routing** — automatically routes tasks to the cheapest model that can handle them

## Architecture

```
┌─────────────┐  ┌─────────┐  ┌──────────────┐
│  groove CLI  │  │   GUI   │  │ Agent Panes  │
└──────┬──────┘  └────┬────┘  └──────┬───────┘
       │              │              │
       ▼              ▼              ▼
  ┌────────────────────────────────────────┐
  │           GROOVE DAEMON (:3141)         │
  │                                        │
  │  Registry · Introducer · Lock Manager  │
  │  Journalist · Rotator · Supervisor     │
  │  Classifier · Router · Teams           │
  └───────────────────┬────────────────────┘
                      │
  ┌───────────────────▼────────────────────┐
  │  Providers: Claude Code · Codex ·       │
  │  Gemini · Aider · Ollama (local)       │
  └────────────────────────────────────────┘
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `groove start` | Start the daemon |
| `groove spawn --role <role>` | Spawn an agent |
| `groove agents` | List all agents |
| `groove kill <id>` | Kill an agent |
| `groove rotate <id>` | Rotate an agent (fresh context) |
| `groove team save <name>` | Save current agents as a team |
| `groove team load <name>` | Load and spawn a saved team |
| `groove providers` | List available AI providers |
| `groove set-key <provider> <key>` | Set API key |
| `groove config show` | Show configuration |
| `groove status` | Daemon status |
| `groove nuke` | Kill everything |

## GUI

Open `http://localhost:3141` after starting the daemon. Features:

- Agent tree visualization (React Flow)
- Spawn modal with role presets and provider selection
- Agent detail sidebar with activity log
- Context usage bars per agent
- Token dashboard with savings calculator
- Journalist feed with live synthesis
- Team management
- Approval queue for out-of-scope access

## Providers

| Provider | Auth | Models | Hot-Swap |
|----------|------|--------|----------|
| Claude Code | Subscription | Opus, Sonnet, Haiku | Yes |
| Codex | API Key | o3, o4-mini | No |
| Gemini CLI | API Key | Pro, Flash | No |
| Aider | API Key | Any | Yes |
| Ollama | Local | Any | No |

## Compliance

GROOVE is a **process manager**, not a harness. It spawns actual AI tool binaries — it never touches OAuth tokens, never proxies API calls, and never impersonates any client.

## Links

- **Website:** [grooveai.dev](https://grooveai.dev)
- **Docs:** [docs.grooveai.dev](https://docs.grooveai.dev)
- **License:** [FSL-1.1-Apache-2.0](LICENSE) (converts to Apache 2.0 after 2 years)
