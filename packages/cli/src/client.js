// GROOVE CLI — HTTP client for daemon communication
// FSL-1.1-Apache-2.0 — see LICENSE

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

function getBaseUrl() {
  if (process.env.GROOVE_URL) return process.env.GROOVE_URL;
  // Read actual port from daemon's port file (supports auto-port rotation)
  try {
    const portFile = resolve(process.cwd(), '.groove', 'daemon.port');
    if (existsSync(portFile)) {
      const port = readFileSync(portFile, 'utf8').trim();
      if (port) return `http://localhost:${port}`;
    }
  } catch { /* fallback */ }
  return 'http://localhost:31415';
}

const BASE_URL = getBaseUrl();

export async function apiCall(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error(body.error || `HTTP ${res.status}`);
    // Carry the response body onto the error. The daemon's actionable fields
    // (availableAgents, didYouMean, note) are the whole point of its error
    // messages — dropping them leaves the caller with a dead end.
    err.status = res.status;
    err.body = body;
    Object.assign(err, body);
    throw err;
  }

  return res.json();
}
