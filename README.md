# Groove OS

**Orchestrate your AI coding agents over localhost.**

The open-source desktop OS for AI coding tools. Spawn multi-agent teams, eliminate cold-starts via our "Journalist" state-tracker, and manage complex workflows with a beautiful GUI dashboard. Your code never touches a centralized server.

[![npm](https://img.shields.io/npm/v/groove-dev)](https://www.npmjs.com/package/groove-dev)
[![License](https://img.shields.io/badge/license-FSL--1.1--Apache--2.0-blue)](LICENSE)

## Get Started

### Download the App

No terminal needed. Download, install, open a project folder.

- [**macOS** (.dmg)](https://github.com/grooveai-dev/groove/releases/latest) — Intel and Apple Silicon
- [**Windows** (.exe)](https://github.com/grooveai-dev/groove/releases/latest) — one-click installer
- [**Linux** (.AppImage)](https://github.com/grooveai-dev/groove/releases/latest) — x64 and ARM

Everything is bundled — daemon, GUI, auto-updates. No Node.js required.

**Zero Dependencies:** The Groove Desktop App is completely self-contained. You do not need to install Node.js, Python, or manage terminal dependencies. Just download, open, and spawn a team.

### Developer Install

```bash
npm i -g groove-dev
groove start
```

The GUI opens at `http://localhost:31415`. On a VPS? groove detects it and tells you exactly what to do.

---

## Desktop App

The desktop app is the easiest way to use groove — no terminal, no dependencies, no setup.

- **Full GUI dashboard** — agent tree, chat, editor, telemetry, marketplace, all in one window
- **Bundled daemon** — starts automatically when you open a project, stops when you close it
- **System tray** — quick access to recent projects, daemon status, and controls
- **Automatic updates** — new versions install silently in the background
- **Multi-workspace** — open any project folder; manages one daemon per project
- **Platform support** — macOS (Intel + Apple Silicon), Windows (x64 + ARM64), Linux (x64 + ARM64)
- **No dependencies** — everything is bundled. No Node.js, no terminal knowledge needed

---

## The Problem

AI coding agents waste your money and lose their way:

- **Cold starts** — every new agent spends thousands of tokens re-learning your codebase
- **Context degradation** — long sessions lead to hallucinations, circular refactors, lost direction
- **No coordination** — multiple agents edit the same files, create conflicts, duplicate work
- **Blind spending** — no visibility into token usage, no way to optimize costs

## The Solution

groove sits between you and your AI coding agents. It doesn't replace them — it makes them work together.

### Zero Cold-Start (The Journalist)

A background AI continuously watches all agent activity and synthesizes it into a living project map. When any agent spawns or restarts, it reads one file and knows everything. No re-explaining your codebase. No wasted tokens on orientation.

### Infinite Sessions (Context Rotation)

Instead of letting agents fill their context window until they degrade, groove detects quality decline — error spikes, circular refactors, file churn — and automatically rotates: kill the session, spawn fresh, feed it the Journalist's context. The agent picks up exactly where it left off with a clean window. No compaction. No drift. Works at any codebase scale.

### AI Project Manager

Agents in Auto mode knock on the PM before risky operations (creating files, deleting, modifying config). The PM reviews against the project plan and scope rules, then approves or rejects with reasoning. Full audit trail in the GUI.

### Quick Launch

Spawn a planner, describe your project. The planner writes a detailed plan and recommends a team. Click **Launch Team** — all agents spawn with proper roles, scopes, and prompts. One click from idea to a full team building your app.

### Workspaces (Large Codebase Support)

groove auto-detects monorepo workspaces (npm, pnpm, lerna) and lets you spawn each agent in its own subdirectory. A frontend agent only sees `packages/frontend/`. A backend agent only sees `packages/backend/`. No wasted context on irrelevant code.

- **Codebase indexer** — scans project structure on start, gives every agent instant orientation
- **Architecture injection** — auto-detects `ARCHITECTURE.md` and injects it into every agent's context
- **Per-workspace journalist** — synthesis and handoff briefs scoped to each agent's directory
- **Quick-pick** — detected workspaces appear as buttons in the spawn panel

### Multi-Agent Coordination

- **Introduction protocol** — every agent knows its teammates, their files, and their work
- **Scope ownership** — agents stay in their lane (backend touches `src/api/**`, frontend owns `src/components/**`)
- **Task negotiation** — duplicate roles get assigned non-overlapping work
- **Knock protocol** — agents signal before shared/destructive actions

## Remote Access

Run groove on a VPS and manage your agents from anywhere. No ports exposed to the internet. No tokens. No custom auth code. Zero attack surface.

### How It Works

groove never opens ports to the public internet. Instead, it uses battle-tested transport layers — SSH tunnels and WireGuard (Tailscale) — to keep your daemon private.

```
Your laptop                          Your VPS
┌──────────┐    SSH tunnel      ┌──────────────────┐
│ Browser  │ ◄────────────────► │ groove daemon    │
│ localhost│    encrypted       │ 127.0.0.1:31415  │
└──────────┘                    └──────────────────┘
                                Zero open ports
```

The daemon always binds to `127.0.0.1`. Nothing reaches it from the public internet. Your SSH keys handle auth. Your browser connects to `localhost` on your machine, and the tunnel forwards traffic securely to the VPS.

### Setup

**On your VPS:**

```bash
npm i -g groove-dev      # install
groove start             # start the daemon
```

**On your laptop:**

```bash
npm i -g groove-dev                    # install (one-time)
groove connect user@your-server-ip     # open the GUI
groove disconnect                      # close when done
```

That's it. The GUI opens in your browser automatically.

groove auto-detects your environment — VS Code Remote, plain SSH, or local — and tells you exactly what to do. SSH config aliases work too: `groove connect my-vps`.

### Tailscale / LAN Access

For multi-device access (phone, tablet, other machines on your network):

```bash
groove start --host tailscale    # auto-detects your Tailscale IP
groove start --host 192.168.1.5  # explicit IP
```

Open `http://<ip>:31415` from any device on the same network. Tailscale handles auth via WireGuard.

### What's Blocked

groove will reject any attempt to expose the daemon directly to the internet:

```bash
groove start --host 0.0.0.0     # REJECTED — not allowed
```

This is by design. Direct exposure requires custom auth, rate limiting, TLS management — attack surface we refuse to create. SSH and WireGuard solve this better than we ever could.

### Federation

Pair groove daemons across machines with Ed25519 key exchange. The security layer is built — cross-server agent coordination (typed contracts, federated registry) is coming soon.

```bash
groove federation pair 100.64.1.5      # pair two daemons
groove federation list                  # see paired peers
groove federation status                # show keypair + peers
```

Every cross-server message is signed with Ed25519 keys generated during a pairing ceremony. The receiving daemon verifies the signature before accepting any contract. Replay attacks are rejected (5-minute timestamp window). Tampered payloads are rejected. Unknown senders are rejected.

```
Server A                              Server B
┌──────────────┐  signed contract  ┌──────────────┐
│ groove daemon│ ◄────────────────►│ groove daemon│
│ Ed25519 key  │   verify + audit  │ Ed25519 key  │
└──────────────┘                   └──────────────┘
```

Contracts are typed data (method, path, input/output schema) — not freeform text. No surface for prompt injection. Full audit trail on both sides.

### Audit Log

Every state-changing operation is logged to `.groove/audit.log`:

```bash
groove audit           # view recent entries
groove audit -n 50     # last 50 entries
```

```log
2:14:32 PM  agent.spawn          id=a1 role=backend provider=claude-code
2:14:35 PM  agent.spawn          id=a2 role=frontend provider=claude-code
2:33:12 PM  agent.rotate         oldId=a1 newId=a3 role=backend
2:45:00 PM  federation.pair      peerId=f63dc52b14b9 peerHost=100.64.1.5
```

Append-only, `0600` permissions, auto-rotates at 5MB. When team auth is added, every entry will include who performed the action.

### Security Model

| Threat | Defense |
|--------|---------|
| Remote attackers | Zero open ports. Daemon binds to private interface only. |
| Network eavesdroppers | SSH (tunnel) or WireGuard (Tailscale) encryption. |
| Spoofed federation contracts | Ed25519 signature verification on every message. |
| Replay attacks | 5-minute timestamp window. Reject old/future contracts. |
| Malformed peer data | Public key validation at pairing time. Peer IDs restricted to hex. |
| Path traversal | Peer IDs sanitized. No filesystem access across servers. |
| Privilege escalation | No auth code to exploit. Transport layer handles all access control. |

**What we explicitly don't defend against:** Compromised SSH keys, root access to VPS, malicious AI provider responses (out of scope — we're a process manager).

**The principle:** "There's nothing to attack" is better than "we have a security system and here's why it's good." groove has zero auth code. The transport layer does all the work.

---

## Works With Everything

| Provider | Auth | Models |
|----------|------|--------|
| **Claude Code** | Subscription | Opus 4.6, Sonnet 4.6, Haiku 4.5 |
| **Codex** | API Key | GPT-5.5, o3, o4-mini |
| **Gemini CLI** | API Key | 3.1 Pro, 3 Flash, 2.5 Pro, 2.5 Flash |
| **Grok** | API Key | Grok 4, 4.1 Fast, Code Fast |
| **Local Models** | Local | Qwen, DeepSeek, Llama, Mistral, Phi, Codestral |
| **Groove Network** | P2P | Federated inference |

groove is a process manager — it spawns actual AI tool binaries. It never proxies API calls, never touches OAuth tokens, never impersonates any client. Your AI tools talk directly to their servers.

Works in any terminal, any IDE, any OS. Technical and non-technical users alike.

## The GUI

Open the dashboard after starting the daemon (local or remote):

- **Agent Tree** — React Flow with slim 200px nodes, animated Bezier edges, minimap, welcome onboarding
- **File Editor** — CodeMirror 6, 7 language modes, file tree, tabs, media viewer, embedded terminal
- **Chat** — bubble UI with mode pills, streaming text, markdown rendering, continue completed agents
- **Dashboard** — KPI strip with sparklines, token/cost charts, fleet panel, savings breakdown, per-team burn
- **Quick Launch** — planner recommends team, one-click spawn all agents
- **Skills Marketplace** — NFT-style skill cards, category bar, search, ratings, integrations tab
- **Team Management** — create, rename, delete teams, inherited defaults
- **Terminal** — xterm.js embedded terminal with resize/fullscreen
- **Command Palette** — Cmd+K fuzzy search with dynamic agent commands

## Pricing

Everything is free and open source. Unlimited agents, teams, context rotation, Layer 7 memory, model routing, dashboard, all providers, federation, remote access, skills marketplace, and scheduling. No tiers, no upgrades, no gates.

## Adaptive Model Routing

groove routes tasks to the cheapest model that can handle them. Planners get Opus (deep reasoning). Backends get Sonnet (balanced). Docs get Haiku (fast and cheap). The classifier learns from agent activity and adjusts over time.

| Tier | Cost | Used For |
|------|------|----------|
| Heavy (Opus) | $0.045/1K | Planning, architecture, complex refactors |
| Medium (Sonnet) | $0.009/1K | Backend, frontend, testing |
| Light (Haiku) | $0.002/1K | Docs, synthesis, simple queries |

## Architecture

```
    ┌──────────────────────────────────────────────┐
    │             groove DAEMON (:31415)           │
    │                                              │
    │  Registry · Introducer · Lock Manager        │
    │  Journalist · Rotator · Adaptive · Indexer   │
    │  Classifier · Router · PM · Teams            │
    │                                              │
    │  REST API · WebSocket · GUI Server           │
    └──────────────────────┬───────────────────────┘
                           │
    ┌──────────────────────▼───────────────────────┐
    │  Claude · Codex · Gemini · Grok · Local · P2P│
    └──────────────────────────────────────────────┘
```

## Links

- **Website:** [groovedev.ai](https://groovedev.ai)
- **Documentation:** [docs.groovedev.ai](https://docs.groovedev.ai)
- **Changelog:** [docs.groovedev.ai/changelog](https://docs.groovedev.ai/changelog)
- **GitHub:** [github.com/grooveai-dev/groove](https://github.com/grooveai-dev/groove)
- **npm:** [npmjs.com/package/groove-dev](https://www.npmjs.com/package/groove-dev)
- **License:** [FSL-1.1-Apache-2.0](LICENSE) — source-available, converts to Apache 2.0 after 2 years
