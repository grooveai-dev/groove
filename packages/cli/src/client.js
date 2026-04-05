// GROOVE CLI — HTTP client for daemon communication
// FSL-1.1-Apache-2.0 — see LICENSE

const BASE_URL = process.env.GROOVE_URL || 'http://localhost:3141';

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
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}
