# Changelog

## v0.27.7 — Revert classifier broadcast — was eating stdout events (2026-04-12)

Planner was producing complete plans (confirmed in stream-json log: full result event, 1.9min, 10 turns, stop_reason end_turn), but the GUI wasn't rendering the final message. Last visible chat was an early exploration message; the plan and subsequent updates never reached the chat UI.

**Root cause.** v0.27.5 added `classifier:update` broadcasts inside `classifier.addEvent()` — which runs synchronously on EVERY stdout event in `process.js` stdout handler, BEFORE the `agent:output` broadcast that actually delivers messages to the chat. Any throw in the added code path (classify iteration, broadcast JSON.stringify on large event contents) would kill the stdout handler for that chunk. The `agent:output` broadcast at line 644 never fires. The plan is silently lost mid-transit.

The v0.26.39 classifier didn't broadcast — it just recorded events. That's why it worked. Shipping the revert.

**Reverted**
- `classifier.js` — full restore to v0.26.39. No `daemon` constructor arg, no `broadcast()` call, no `_lastBroadcastCount` throttle.
- `index.js` — `new TaskClassifier()` (back to no-arg constructor).

**Consequence**
- GUI no longer gets mid-session `classifier:update` events. The downshift suggestion API (`GET /api/agents/:id/routing/suggestion`) still works, just won't push real-time updates. This was a Phase 5 enhancement that wasn't worth breaking message delivery for.

## v0.27.6 — Revert rotator safety triggers — kill switch was killing planners (2026-04-12)

User noticed rotations happening at 25-35% context window — way below the 75% threshold. Root cause: quality-based rotation was firing during planner thinking phases. Chain:

1. Planner explores (grep, find, cat with `2>/dev/null`) — normal planning work
2. Classifier sees non-zero exits as "errors"; quality score tanks
3. Planner pauses to synthesize plan — `lastActivity` doesn't update during thinking
4. Rotator sees: idle > 10s + score < 55 + events > 30 — kills planner mid-thought
5. New instance spawns but doesn't recover the plan output

I raised `QUALITY_THRESHOLD` from 40 → 55 in v0.27.0 thinking it would catch degradation earlier. Instead it made the rotator trigger-happy on the exact agents whose normal work looks "bad" to the classifier (planners doing exploration, fullstack auditors reviewing code).

**Reverted `rotator.js` entirely to v0.26.39.** The rotator that worked through 275M tokens without killing planners. This removes:
- Safety ceiling (token_limit_exceeded) and role multipliers — added in v0.27.0
- Velocity trigger (already removed in v0.27.2)
- Rotation cooldown — added in v0.27.0
- Converged-profile gate — added in v0.27.0
- Pre/post velocity measurement — added in v0.27.0
- Handoff-chain write on rotation — added in v0.27.0
- Specialization update from rotator — added in v0.27.0
- Raised quality threshold (55 → 40) and min events (30 → 10)

Also removed the associated test cases.

**What's preserved from v0.27.x**
- MemoryStore module (data still accumulates from agent completion via process.js)
- Dashboard additions (token panel, memory tab, overhead section, cache fix)
- Journalist token tracking under reserved IDs
- `__negotiator__` tracking on task negotiation
- Handoff brief v0.27.4 wording (rotation-only, shouldn't fire often now)

No safety net other than the rotator's original context-threshold and quality-threshold triggers. If a truly runaway agent burns 50M tokens, it'll hit context rotation naturally — no ceiling needed.

## v0.27.5 — Revert planner/introducer changes (2026-04-12)

Planner flow stopped producing output after v0.27.x intro changes — agents would do partial exploration and stop without outputting a plan. After several failed targeted fixes (v0.27.3, v0.27.4), reverting `introducer.js` and the planner role prompt in `process.js` back to their v0.26.39 state rather than continue iterating on a broken premise. The planner flow that worked through 275M tokens is what should ship.

**What's reverted**
- `packages/daemon/src/introducer.js` — fully restored to v0.26.39. This removes:
  - Project Memory injection at spawn (memory still accumulates, just not injected)
  - "Ready to resume" team section enhancement from v0.27.3
  - HTTP-based coordination protocol rewrite (back to `.groove/coordination.md` advisory)
  - Memory API contribution note
- `packages/daemon/src/process.js` planner role prompt — fully restored to v0.26.39.

**What's preserved**
- All backend infrastructure: MemoryStore module, safety token ceiling + role multipliers, token tracking, cache formula fix, dashboard, tests.
- Journalist handoff brief v0.27.4 rewrite (only affects rotations; safety ceiling is 50M for planners so rotations should be extremely rare).
- Specialization updates on agent completion (re-added to process.js after revert).
- `__negotiator__` token tracking on task negotiation calls (re-added).

Memory accumulation still works — the rotator writes handoff chains, agent completion updates specializations. The data is captured for future use, it's just not injected into every new agent's intro context. If the injection experiment is worth retrying, it'll be in a separate release with careful A/B testing, not a surprise change.

**Apologies.** I should have done this revert two versions ago when the bug persisted. Trying to patch the symptoms kept the planner in a broken state for longer than necessary.

## v0.27.4 — Fix rotated agents abandoning mid-task work (2026-04-12)

**The bug I introduced in v0.27.1.** The rotation handoff brief told agents: *"Wait for the user's next message, then answer it directly."* That instruction was intended to prevent "Resuming after rotation" announcements — but for an agent that was mid-task when rotation fired (e.g., a planner planning, a backend writing code), it said: *stop the work, wait for the user.* The user gave a direct feature request, the planner burned 3M tokens exploring before rotation, the new planner read "wait for next message" and delivered nothing.

**Fix**
- Rewritten handoff brief flips the instruction: *"Finish what you were doing. The user is waiting for YOUR output. Produce it. No preamble, no announcement."*
- Explicitly calls out common mid-task states: "If you were a planner about to output a plan, output the plan now. If you were a builder about to make edits, make the edits."
- Recent User Messages section is now labeled "what they've been asking for — deliver this."
- Memory API contribution note de-emphasized (no longer prompts agents to proactively POST to `/api/memory/*` — it's opt-in, not a requirement).

**Regression test added** to lock the fix: any brief containing "wait for the user's next message" now fails CI.

## v0.27.3 — Planner sees ready-to-resume teammates (2026-04-12)

Fixes a Mode 1 / Mode 2 detection bug where a planner spawned duplicate agents instead of routing work to existing teammates.

**The bug**
When a team is created with empty prompts (the "spawn the team first, then assign tasks" pattern), the builders complete in a few seconds (no task to do → return). Their status flips to `completed`. Later, when the planner spawns and looks at its intro context, the team section only listed `running`/`starting` agents — so the planner saw "you are the only agent on this project right now" and went Mode 1, spawning duplicates instead of routing to the existing ready-to-resume team.

Not a regression from v0.27.x — this has been brittle for any empty-prompt team flow. Surfaced now.

**Fix**
- Introducer's team section now includes **recent completed teammates** alongside active ones, scoped to the same `teamId` with a 1-hour freshness window. Shown as "ready to resume" with an explicit note: *"Teammates marked 'ready' are part of your team. They finished their last task and will resume their session when assigned new work. If you're a planner, route new tasks to them by role — do NOT spawn duplicates."*
- Planner role prompt (`process.js`) updated: Mode 2 detection now references the intro context's Team section directly, not just `AGENTS_REGISTRY.md`. Explicitly instructs: *"Teammates listed as 'ready to resume' are REAL agents. They WILL pick up new work when routed. NEVER spawn a new agent of a role that already exists."*

**What this means for you**
The flow that felt perfect — spawn the team, then iterate with the planner task-by-task — now works regardless of whether the builders are actively running or resting between tasks.

## v0.27.2 — Drop velocity trigger (2026-04-12)

Following up on v0.27.1: the role-multiplier fix addressed the planner but left the same false-positive class live for any agent doing heavy exploration on a large codebase. Dropping velocity-based rotation entirely rather than papering over it further.

**What changed**
- Removed `runaway_velocity` as a rotation trigger. The logic is gone — not disabled, gone.
- `safety.velocityWindowSeconds` and `safety.velocityTokenThreshold` config keys removed.
- Token ceiling remains as the single safety net. Per-instance ceiling + role multipliers (planner 10×, fullstack/security 4×, analyst 5×) catch genuinely runaway agents without tripping on fast legitimate work.
- Stats still expose `velocityRotations` count for historical rotations already in `rotation-history.json`.
- GUI intel-panel's `V:` badge handling preserved for viewing historical events.

**Why**
Velocity alone is a bad stuck-loop signal — legitimate heavy work is fast. The only signal that actually distinguishes a runaway from real work is speed combined with non-productivity (repetitions, errors, file churn). Rather than build the gate now, we're waiting for real usage data to see if earlier-warning is actually needed. The ceiling catches real runaways. Adaptive context rotation catches degradation. If a pattern emerges from heavy real-world use that needs an earlier safety net, it'll be re-added gated on quality signals — not velocity.

**Measurement still works.** Pre/post-rotation velocity is still captured in rotation history for savings measurement. We just don't trigger on it.

Tests: 221 → 220 (−1 net; added ceiling-only coverage, removed velocity-specific tests).

## v0.27.1 — Seamless rotation hotfix (2026-04-12)

Fixes a severe UX regression where planner and other exploration-heavy agents auto-rotated on legitimate activity, breaking the "infinite sessions" promise.

**The bug**
Running a planner on a new project triggered `runaway_velocity` rotation at 2M tokens / 5min — which is normal behavior for a planner reading a codebase. The rotation killed the chat panel, reset the agent, and made the session feel broken. The whole point of context rotation is that it should be invisible to the user.

**Fixes**

- **Role-based safety multipliers.** Planners, fullstack auditors, analysts, and security roles now have much higher velocity/ceiling thresholds by default. Planner gets 10× (effective 15M/5min), fullstack/security get 4×, analyst 5×. Implementers (backend, frontend) stay at 1×. User-overridable via `safety.roleMultipliers` config.
- **Handoff brief rewritten for seamless continuation.** The agent is no longer told "this is a context rotation, the previous session is being replaced." It's now instructed to continue the conversation naturally — no greetings, no "resuming", no announcement. From the user's side, the conversation never paused.
- **User's recent messages included in the brief.** Previously the new agent had no memory of what the user was asking for. Now the last 5 user messages to this agent are carried forward so the conversation resumes with full context.
- **Chat history always migrates on rotation.** Previously only migrated when the user had the old agent's detail panel open — if they'd navigated away, chat was orphaned forever. Now migrates unconditionally for all agent-keyed state (chat, activity log, token timeline, draft input). Persisted to localStorage immediately.
- **Rotation toasts silenced.** "Rotating..." and "Rotated, saved X tokens" toasts removed from the default flow. Rotations still fully visible in the dashboard Intel panel for users who want to see them.

Tests: 218 → 221 (+3 covering planner multiplier and config overrides).

## v0.27.0 — Audit-driven release: visibility, safety, Layer 7 memory (2026-04-12)

Backend audit after a 275M-token stress test revealed three classes of gaps: blind spots (invisible tokens), unvalidated claims (hardcoded coefficients posing as measurements), and missing memory (every new agent started from scratch). This release closes all three.

**Visibility — you can now see what's actually happening**
- Journalist, PM, planner, negotiator, gateway, and agent-QA headless calls now record tokens under reserved IDs (`__journalist__`, `__pm__`, etc.) — previously invisible 1-6M tokens/day now tracked
- Cache hit rate formula fixed: denominator was incorrectly including fresh input tokens; corrected to `reads / (reads + creation)` so the number reflects real cache efficiency
- New `GET /api/tokens/by-team` endpoint — ranked team burn breakdown answers "which team used the most tokens?" in one call
- Dashboard gets a new Team Burn panel with per-team bars, cost, and agent count
- Per-agent cache rate in `/api/dashboard` uses the corrected formula
- `projectRoot` field reserved in token session records for future per-workspace grouping

**Safety — the system self-heals on pathological agents**
- Token ceiling auto-rotate: when an agent burns more than `safety.tokenCeilingPerAgent` (default 5M) since its spawn, rotator fires `token_limit_exceeded` rotation with journalist handoff brief
- Velocity auto-rotate: when an agent burns more than `safety.velocityTokenThreshold` (default 1.5M) in a rolling `safety.velocityWindowSeconds` window (default 300s), rotator fires `runaway_velocity`
- Both triggers use existing rotation infrastructure — no new kill/respawn code, just new `shouldRotate()` conditions
- Triggers scoped to `spawnedAt` so post-rotation agents don't re-trigger on inherited cumulative tokens
- Coordination protocol is now enforced, not advisory: `POST /api/coordination/declare` acquires a short-lived resource lock; returns 423 on conflict with owner + expiry info; auto-expires after 10min to prevent deadlock
- Introducer now instructs agents to use the HTTP protocol instead of editing `.groove/coordination.md`
- Intel panel shows safety-triggered rotations with distinct badges (`T:5M` red, `V:1.5M` orange) and hover tooltips

**Layer 7 — persistent agent memory**
- New `MemoryStore` module (`memory.js`) persists four file types in `.groove/memory/`:
  - `project-constraints.md` — hash-deduped project rules (capped at 50)
  - `handoff-chain/<role>.md` — last 10 rotation briefs per role, newest first
  - `agent-discoveries.jsonl` — error→fix pairs (success-only, 1000-entry cap)
  - `agent-specializations.json` — per-agent + per-role quality profiles
- Rotator appends brief to chain on every rotation; journalist reads last 3 into new briefs for causal continuity across rotations
- Introducer injects accumulated memory into every new agent spawn (constraints + recent handoffs + known patterns, 12K char budget)
- Process manager updates specializations on agent completion/crash (avg quality, file touches, error signatures)
- 9 new API endpoints for CRUD on all four memory types
- 26 new unit tests covering dedup, size caps, role-scoped filtering, persistence

**Rotation intelligence**
- `QUALITY_THRESHOLD` raised 40 → 55 (tuned up from hair-trigger threshold)
- `MIN_EVENTS` raised 10 → 30 (require ~100 turns of stable signal before scoring)
- New 5-minute rotation cooldown prevents back-to-back churn on persistently low-quality tasks
- Safety triggers bypass cooldown (pathological burn must stop immediately)
- Converged adaptive profiles get a deeper quality floor (threshold - 15) before rotating — if the threshold has stabilized, trust it
- Pre/post-rotation velocity captured on every rotation; `velocityDelta` computed after new agent has 10 min of data — replaces hardcoded 30% assumption with measurable signal for future accuracy tuning

**Mid-session classification (never silent downshift)**
- Classifier broadcasts `classifier:update` events every 20 events once it has 40+ — enables UI to surface downshift suggestions
- `GET /api/agents/:id/routing/suggestion` returns `{ currentModel, suggestedModel, classifiedTier, eventCount, reason }` when a lighter model would handle the current task
- NEVER auto-applied — user must accept via UI click (heavy defaults principle preserved)
- Never upshifts — only suggests moving to a cheaper tier
- Returns 204 when classifier has no strong suggestion

**Cleanup and dependencies**
- Removed unused code: `sanitizeForFilename`, `formatDuration`, `dashTelemetry`, `ccChartTimeline`, entire `dropdown-menu.jsx` and `use-media-query.js`
- Removed unused Radix deps (`react-popover`, `react-separator`, `react-dropdown-menu`)
- Fixed duplicate `bundledDependencies` / `bundleDependencies` keys in root package.json
- Archived v1 build plan to `docs/archive/GROVE_BUILD_PLAN.md`; v2 plan is the active document
- Workspace versions synced: daemon/cli/gui/root all at 0.26.39 (tagged 0.27.0 on release)
- `.DS_Store` and stale logs cleaned
- GUI dist/ rebuilt from scratch

**Tests: 137 → 218 (+81 new)**

## v0.26.33 — Self-building pipeline, team persistence, agent quality overhaul (2026-04-11)

Major release: Groove now builds itself. Full team lifecycle, intelligent context synthesis, and agent quality improvements across the board.

**Team Persistence and Agent Reuse**
- Teams are persistent — agents stay across tasks instead of respawning every time
- Launch flow reuses existing agents by role: planner delegates, existing frontend/backend resume with new task and full context
- Auto-delegate: when all required roles exist in the team, planner skips the Launch modal and routes work directly (toast notification)
- QC lifecycle: spawns idle when no work, auto-triggers with teammate context when agents complete real work
- Cross-scope handoffs: agents write `.groove/handoffs/{role}.md`, system auto-routes to the owning agent

**Planner Intelligence**
- Mode 1 (team creation): full codebase exploration, detailed team structure
- Mode 2 (task routing): detects existing team via AGENTS_REGISTRY.md, reads only relevant files, routes to existing agents — fast, under 5 tool calls
- Always writes recommended-team.json, even for team-building-only mode (empty prompts = agents await instructions)

**Agent Quality**
- Role prompts for all 16 agent roles — frontend gets full design system (colors, CSS variables, fonts, components), backend gets ESM conventions and compliance rules
- All roles default to Heavy tier (Opus) — intelligence out of the box, users opt into cheaper models
- Permission and scope changes now persist (added to registry SAFE_FIELDS)

**Journalist Overhaul**
- Dropped exploration noise: Read/Glob/Grep tool calls no longer clutter synthesis
- Edit diffs captured: `"bg-[#3e4451]" -> "HEX.accent"` shows in project map
- Bash output captured: `npm test -> 141 passed` gives agents build/test context
- Thinking threshold raised (50 -> 200 chars) — only real decisions survive
- Transient stderr errors dropped — no more phantom error degradation
- User feedback tracking: messages to agents recorded and injected into future agent context, persisted to disk
- Decisions log deduplication: >60% word overlap with previous entry = skip
- Completed agents persist in project map for 30 minutes after finishing
- Decisions log capped at 20 entries

**Promote Pipeline**
- `./promote.sh`: build GUI -> run tests -> staging daemon on :31416 -> verify -> publish to npm + push to GitHub
- Staging uses isolated `.groove-staging/` directory — doesn't kill running daemon
- npm registry retry with version verification and cache clear
- Explicit file staging (no `git add -A`) for safety

**UX Improvements**
- Thinking indicator: rich animated phases (Analyzing, Reasoning, Planning...), elapsed timer, shimmer sweep, fires immediately on all launch paths
- Chat message dedup: Claude Code assistant + result events no longer double up
- Chat input persists across tab switches (stored in Zustand per agent)
- Agent tree: debounced fitView prevents jitter on team launch, node positions saved by name (stable across resumes)
- Edge handles recalculated from actual node positions on every render
- HTML preview in editor: Code/Preview toggle for .html files via sandboxed iframe
- Context bars use teal accent color (agent nodes + fleet panel)

**Infrastructure**
- Terminal PTY uses crypto.randomUUID() instead of predictable counters
- Codex agents skip PM gate (sandboxed providers can't reach localhost)
- Skill marketplace: Pull Latest, Uninstall, and Update flow
- Auth logs scrubbed — username only, no PII
- GC: immediate cleanup on team delete, orphaned logs removed instantly
- QC agents verify builds (`npm run build`), never start long-running dev servers

## v0.20.0 — Settings page, Ollama setup, GUI v2 rebuild, full system overhaul (2026-04-08)

Major release: complete GUI rebuild + Settings page + Ollama setup + tech debt cleanup.

**Settings Page**
- Full-width card grid layout matching dashboard style
- Provider cards: status dots, model pills, "API Connected" / "Subscription active" / "Add API Key" states
- API key management: labeled input with show/hide toggle, Save/Cancel, proper spacing when active
- Ollama setup inline: hardware detection, install guide, model catalog with one-click pull
- Configuration: segmented pill controls — Rotation Threshold (Auto/50-85%), QC Threshold (2-8), Max Agents (∞/4-20), Journalist Interval (1-10m)
- Working Directory with FolderBrowser, Default Provider dropdown
- Account hero bar: daemon info, marketplace sign-in, status dot

**GUI v2 Rebuild (v0.19.0)**
- 23 old files deleted, 59 new components across 6 categories
- Tailwind CSS v4, Radix UI, CodeMirror 6, xterm.js, React Flow
- VS Code-style layout: Activity Bar, Breadcrumb, Status Bar, Detail Panel, Terminal

**Backend**
- Timeline tracking (metrics snapshots + lifecycle events)
- Teams overhaul (live groups replacing snapshots)
- Ollama provider: 22-model catalog, hardware detection, server lifecycle, model pull/delete
- 7 new API endpoints for Ollama operations
- Provider interface cleanup, dead code removal

**Fixes**
- Page load flicker (hydration gate)
- Toast text alignment
- Restart button removed (chat resumes agents)
- Config tab reorder (model first)
- CLI version synced
- Auto-generated files gitignored

## v0.19.9 — Settings polish: correct provider states, segmented controls, folder browser (2026-04-08)

- **Provider Ready logic** — API-key providers (Codex, Gemini) only show "Ready" when key is actually set, not just when CLI is installed
- **Remove Auto Rotation** — removed from settings (per-agent setting, not global)
- **Segmented controls** — Rotation Threshold (Auto/50%/65%/75%/85%), QC Threshold (2/3/4/6/8, default 2), Max Agents (∞/4/8/12/20), Journalist Interval (1m/2m/5m/10m) — no more broken number inputs
- **Working Directory** — added Browse button using FolderBrowser component from agent panel
- **Card alignment** — Add API Key buttons pinned to card bottom with flex spacer, no more stagger
- **Subscription state** — Claude shows "Subscription active" + optional API key for headless, Codex/Gemini show "API Connected" when key is set

## v0.19.8 — Provider card states: API Connected, subscription toggle (2026-04-08)

- **Codex/Gemini** — when API key is set, shows green "API Connected" badge instead of masked key + "Add API Key"
- **Claude Code** — shows blue "Subscription active" badge when installed, plus "Add API key for headless mode" link to optionally add an API key
- **All providers** — three clear states: connected (green), subscription (blue), needs key (add button). Edit/Remove links for connected keys.

## v0.19.7 — Settings: full-width card grid layout (2026-04-08)

- **Full viewport layout** — matches dashboard style, no max-width constraint, edge-to-edge cards
- **Account hero bar** — top bar with page title, daemon info (version, port, uptime), marketplace sign-in/avatar, status dot
- **Provider cards** — 4-column grid, each card shows status dot, name, ready badge, models, API key inline (no expand needed), Ollama gets "Manage Models" button that opens setup inline
- **Config grid** — 3-column card grid, each setting is its own card with icon badge, label, description, and control. Auto-saves on change.
- **Section headers** — uppercase tracking labels with horizontal rule and count/status on right

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
