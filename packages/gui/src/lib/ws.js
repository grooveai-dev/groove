// GROOVE GUI — WebSocket client utility
// FSL-1.1-Apache-2.0 — see LICENSE

export function createWebSocket(url, handlers) {
  const ws = new WebSocket(url);

  ws.onopen = () => handlers.onOpen?.();
  ws.onclose = () => handlers.onClose?.();
  ws.onerror = (err) => handlers.onError?.(err);
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handlers.onMessage?.(data);
    } catch {
      // Ignore non-JSON messages
    }
  };

  return ws;
}
