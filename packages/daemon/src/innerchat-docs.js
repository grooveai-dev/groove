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
    '```bash',
    `curl -s http://localhost:${port}/api/innerchat/ask -X POST -H 'Content-Type: application/json' \\`,
    `  -d '{"from":"${agentName}","to":"AGENT_NAME","message":"YOUR_QUESTION"}'`,
    '```',
    '',
    'The command BLOCKS until they answer, then returns:',
    '`{"from":"...","reply":"...","exchangesUsed":N,"exchangesRemaining":N}`',
    '',
    'Call it again to continue — prior turns are included automatically, so just say',
    'the next thing. Keep going until you reach a conclusion together, then report',
    'that conclusion to the user.',
    '',
    '**Rules:**',
    '- Only start a conversation when the user asks you to. Never consult other agents on your own initiative.',
    `- \`from\` must be your own agent name${agentName === 'YOUR_NAME' ? ' (it is in your $GROOVE_AGENT_NAME environment variable)' : ''}.`,
    '- Agent names are listed in `AGENTS_REGISTRY.md`, including agents on other teams.',
    '- One question per call. Wait for the answer before deciding what to ask next.',
    '- Read any error you get back — it tells you what to do (unknown name, cap reached, or they are waiting on you).',
    '- `exchangesRemaining` counts down. At 0 the conversation is over: stop and report what you have.',
    '- If another agent asks YOU something, answer it directly in your next message. They are blocked until you do.',
  ];
}
