// FSL-1.1-Apache-2.0 — see LICENSE

// The agent-facing InnerChat instructions, in one place.
//
// These are injected into a new agent's spawn prompt AND written into every
// AGENTS_REGISTRY.md. Both are needed: the prompt reaches the agent on turn
// one, and the file survives context compaction — an agent that has forgotten
// the prompt can re-read the registry it already knows to consult.
//
// No imports on purpose — process.js and introducer.js both pull from here.

export function innerChatInstructions(port = 31415, agentName = 'YOUR_NAME') {
  return [
    '## Consulting Other Agents (InnerChat)',
    '',
    'Other GROOVE agents may be working alongside you, including on other teams.',
    'When the user asks you to reach out to, coordinate with, or get input from',
    'another agent, use this — it sends them a message and waits for their reply:',
    '',
    '> **Do NOT use your built-in `SendMessage` / Agent tools to reach a GROOVE agent.**',
    '> Those only address sub-agents you spawned yourself in this session, so they will',
    '> fail with "not reachable" or ask you for an `a…-…` agent ID that does not exist',
    '> here. GROOVE agents are separate processes. The curl below is the only way to',
    '> reach them. Do not invent a fallback (writing a message into a file, etc.) —',
    '> if the curl fails, read the error and report it to the user.',
    '',
    '```bash',
    `curl -s http://localhost:${port}/api/innerchat/ask -X POST -H 'Content-Type: application/json' \\`,
    `  -d '{"from":"${agentName}","to":"AGENT_NAME","message":"YOUR_QUESTION"}'`,
    '```',
    '',
    'This BLOCKS until they answer, then returns:',
    '`{"from":"...","reply":"...","exchangesUsed":N,"exchangesRemaining":N}`',
    '',
    '> **Run the curl in the FOREGROUND and let it block.** Do not background it with',
    "> `&`, and never put `&` inside the command — that detaches the curl and throws away",
    "> the reply, so you get no answer and can't confirm delivery. Blocking for a minute or",
    '> two is expected and correct; just wait for it. If you truly cannot wait, use `tell`',
    '> (below) instead — that is the right tool for fire-and-forget, not a backgrounded ask.',
    '',
    'Call it again to continue — prior turns are included automatically, so just say',
    'the next thing. Keep going until you reach a conclusion together, then report',
    'that conclusion to the user. `ask` is best for tight back-and-forth (negotiating',
    'an interface, resolving a blocker) where you need the answer before you proceed.',
    '',
    'If the other agent is heads-down and you do NOT need the answer right now, send it',
    'without blocking instead — this returns immediately, and their reply (if any) is',
    'delivered back to you later, waking you if your turn has ended:',
    '',
    '```bash',
    `curl -s http://localhost:${port}/api/innerchat/tell -X POST -H 'Content-Type: application/json' \\`,
    `  -d '{"from":"${agentName}","to":"AGENT_NAME","message":"YOUR_MESSAGE"}'`,
    '```',
    '',
    '**Rules:**',
    '- Only start a conversation when the user asks you to. Never consult other agents on your own initiative.',
    `- \`from\` must be your own agent name${agentName === 'YOUR_NAME' ? ' (it is in your $GROOVE_AGENT_NAME environment variable)' : ''}.`,
    '- Agent names are listed in `AGENTS_REGISTRY.md`, including agents on other teams.',
    '- Use `ask` when you need the reply now; use `tell` to hand off or notify without waiting.',
    '- One message per call. With `ask`, wait for the answer before deciding what to ask next.',
    '- Ground truth lives in files (specs, code, run output), not in chat — use InnerChat to',
    '  negotiate and hand off, and verify claims against the actual artifacts.',
    '- Read any error you get back — it tells you what to do (unknown name, cap reached, or they are waiting on you).',
    '- `exchangesRemaining` counts down (shared by ask and tell). At 0 the conversation is over: stop and report.',
    '- If another agent asks YOU something (a blocking ask), answer it directly in your next message — they are blocked until you do.',
  ];
}

// Wake-on-completion. Same delivery/injection story as InnerChat above.
export function watchInstructions(port = 31415, agentName = 'YOUR_NAME') {
  const nameHint = agentName === 'YOUR_NAME' ? ' ($GROOVE_AGENT_NAME)' : '';
  return [
    '## Getting Notified When Something Finishes (Watch)',
    '',
    'Your process ends when your turn ends, so a test suite or long job you kicked',
    'off has nothing to notify you — telling the user "I\'ll report back when it lands"',
    'does not work on its own; the session is gone. Instead, set a Watch. The daemon',
    'outlives your turn and RESUMES you with the result when it finishes:',
    '',
    '```bash',
    `curl -s http://localhost:${port}/api/watch -X POST -H 'Content-Type: application/json' \\`,
    `  -d '{"agent":"${agentName}","label":"test suite","command":"npm test"}'`,
    '```',
    '',
    'This returns immediately with a `watchId`. **End your turn** — you will be woken',
    'with the exit code and output tail when the command finishes.',
    '',
    '- Prefer `command` (let the daemon run it) over launching it yourself — that way',
    '  it captures the real exit code and output.',
    '- For something ALREADY running, poll instead with `until` (fires when the check',
    `  exits 0): \`-d '{"agent":"${agentName}","label":"server up","until":"curl -sf localhost:3000/health"}'\`.`,
    `- \`agent\` must be your own name${nameHint}.`,
    '- Watches time out (default 30 min). One clear task per watch; do not watch trivial commands you could just run.',
    '- Do not poll or sleep-loop waiting yourself — set the watch and end the turn. That is the whole point.',
  ];
}
