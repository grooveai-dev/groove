// GROOVE GUI — REST API client
// FSL-1.1-Apache-2.0 — see LICENSE

const BASE = '';

export async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const getAgents = () => api('GET', '/api/agents');
export const spawnAgent = (config) => api('POST', '/api/agents', config);
export const killAgent = (id) => api('DELETE', `/api/agents/${id}`);
export const getStatus = () => api('GET', '/api/status');
export const getTokens = () => api('GET', '/api/tokens');
