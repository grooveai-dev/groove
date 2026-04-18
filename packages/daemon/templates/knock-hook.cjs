#!/usr/bin/env node
// GROOVE — Claude Code PreToolUse hook for knock protocol enforcement.
// Reads a tool-use payload from stdin, forwards it to the daemon's /api/knock
// endpoint with the agent ID attached, and blocks the tool (exit 2) if the
// daemon denies. Fails open on any error so daemon hiccups don't break agents.

const http = require('http');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  try {
    const data = input ? JSON.parse(input) : {};
    const agentId = process.env.GROOVE_AGENT_ID;
    if (!agentId) { process.exit(0); }
    const port = Number(process.env.GROOVE_DAEMON_PORT) || 31415;
    const host = process.env.GROOVE_DAEMON_HOST || '127.0.0.1';
    const body = JSON.stringify({ ...data, grooveAgentId: agentId });
    const req = http.request({
      host, port, path: '/api/knock', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(out);
          if (parsed && parsed.allow === false) {
            process.stderr.write(String(parsed.reason || 'Blocked by GROOVE PM: operation conflicts with another agent or violates scope rules.'));
            process.exit(2);
          }
        } catch { /* fail open */ }
        process.exit(0);
      });
    });
    req.on('error', () => process.exit(0));
    req.setTimeout(3000, () => { try { req.destroy(); } catch {} process.exit(0); });
    req.write(body);
    req.end();
  } catch {
    process.exit(0);
  }
});
