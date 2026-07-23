// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useGrooveStore } from '../../stores/groove';
import { TerminalPanel } from '../layout/terminal-panel';

const THEME = {
  background: '#1a1e25',
  foreground: '#c8ccd4',
  cursor: '#33afbc',
  cursorAccent: '#1a1e25',
  selectionBackground: 'rgba(51, 175, 188, 0.3)',
  selectionForeground: '#ffffff',
  black: '#1a1e25', red: '#e06c75', green: '#4ae168', yellow: '#e5c07b',
  blue: '#61afef', magenta: '#c678dd', cyan: '#33afbc', white: '#abb2bf',
  brightBlack: '#5c6370', brightRed: '#f07178', brightGreen: '#4ae168', brightYellow: '#e5c07b',
  brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
};

let tabCounter = 0;
let spawnSeq = 0;

function TerminalInstance({ tabId, visible, registerKill, onSelectionChange }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const termIdRef = useRef(null);
  const handlerRef = useRef(null);
  const mountedRef = useRef(false);
  const visibleRef = useRef(visible);
  const lastSizeRef = useRef({ cols: 0, rows: 0 });
  const outputReadyRef = useRef(false);

  useEffect(() => {
    registerKill?.(tabId, () => {
      const ws = useGrooveStore.getState().ws;
      if (ws?.readyState === WebSocket.OPEN && termIdRef.current) {
        ws.send(JSON.stringify({ type: 'terminal:kill', id: termIdRef.current }));
      }
    });
  }, [tabId, registerKill]);

  // Run a command dropped into the store by another component (e.g. a "tail
  // log" chip in chat). Only the visible tab handles it, and we poll until this
  // instance's PTY is ready — a freshly opened terminal spawns asynchronously,
  // and keystrokes sent before it's ready are dropped.
  const pendingCommand = useGrooveStore((s) => s.terminalPendingCommand);
  useEffect(() => {
    if (!pendingCommand || !visible) return;
    let tries = 0;
    let timer = null;
    const send = () => {
      const ws = useGrooveStore.getState().ws;
      if (ws?.readyState === WebSocket.OPEN && termIdRef.current && outputReadyRef.current) {
        ws.send(JSON.stringify({ type: 'terminal:input', id: termIdRef.current, data: pendingCommand.command + '\r' }));
        useGrooveStore.getState().clearTerminalPendingCommand();
        return;
      }
      if (tries++ < 40) timer = setTimeout(send, 150); // ~6s max, covers spawn
    };
    send();
    return () => clearTimeout(timer);
  }, [pendingCommand, visible]);

  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return;
    mountedRef.current = true;

    const term = new XTerm({
      theme: THEME,
      fontFamily: "'SF Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
      fontSize: 12,
      lineHeight: 1.1,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 1,
      scrollback: 10000,
      allowProposedApi: true,
      minimumContrastRatio: 1,
      drawBoldTextInBrightColors: true,
      fontWeight: '400',
      fontWeightBold: '600',
      overviewRulerWidth: 0,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fitAddon;

    term.onSelectionChange(() => {
      const text = term.getSelection();
      onSelectionChange?.(text || '');
    });

    // ── Spawn logic ──────────────────────────────────────────────
    let spawnAttempts = 0;
    let outputReady = false;

    function trySpawn() {
      spawnAttempts++;
      const ws = useGrooveStore.getState().ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        if (spawnAttempts < 20) setTimeout(trySpawn, 500);
        return;
      }

      const requestId = `spawn-${++spawnSeq}`;
      ws.send(JSON.stringify({ type: 'terminal:spawn', cols: term.cols, rows: term.rows, requestId }));

      function onMessage(event) {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'terminal:spawned' && msg.requestId === requestId && !termIdRef.current) {
          termIdRef.current = msg.id;
          // Give the shell time to start and the layout to fully settle,
          // then correct dimensions, wipe any garbled output, and redraw.
          setTimeout(() => {
            try { fitAddon.fit(); } catch {}
            const c = term.cols, r = term.rows;
            if (c > 1 && r > 1 && termIdRef.current) {
              const w = useGrooveStore.getState().ws;
              if (w?.readyState === WebSocket.OPEN) {
                w.send(JSON.stringify({ type: 'terminal:resize', id: termIdRef.current, rows: r, cols: c }));
                lastSizeRef.current = { cols: c, rows: r };
              }
            }
            // Wipe xterm so garbled output from wrong-sized PTY is never visible
            term.reset();
            outputReady = true;
            outputReadyRef.current = true;
            // Ask the shell to clear screen and redraw its prompt
            const w2 = useGrooveStore.getState().ws;
            if (w2?.readyState === WebSocket.OPEN && termIdRef.current) {
              w2.send(JSON.stringify({ type: 'terminal:input', id: termIdRef.current, data: '\x0c' }));
            }
          }, 300);
        } else if (msg.type === 'terminal:output' && msg.id === termIdRef.current) {
          if (outputReady) term.write(msg.data);
        } else if (msg.type === 'terminal:exit' && msg.id === termIdRef.current) {
          outputReady = true;
          outputReadyRef.current = false; // no live shell to accept commands
          term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n');
          termIdRef.current = null;
        }
      }

      ws.addEventListener('message', onMessage);
      handlerRef.current = { ws, handler: onMessage };

      term.onData((data) => {
        const ws = useGrooveStore.getState().ws;
        if (ws?.readyState === WebSocket.OPEN && termIdRef.current) {
          ws.send(JSON.stringify({ type: 'terminal:input', id: termIdRef.current, data }));
        }
      });

      // Debounce resize messages so rapid drag doesn't flood
      // the PTY with SIGWINCHs that cause staircase redraws
      let resizeTimer = null;
      term.onResize(({ cols, rows }) => {
        if (cols === lastSizeRef.current.cols && rows === lastSizeRef.current.rows) return;
        if (cols < 2 || rows < 2) return;
        lastSizeRef.current = { cols, rows };
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          const { cols: c, rows: r } = lastSizeRef.current;
          const ws = useGrooveStore.getState().ws;
          if (ws?.readyState === WebSocket.OPEN && termIdRef.current) {
            ws.send(JSON.stringify({ type: 'terminal:resize', id: termIdRef.current, rows: r, cols: c }));
          }
        }, 150);
      });
    }

    // ── Deferred spawn — wait for container to be visible & stable ──
    let hasSpawned = false;
    let settleTimer = null;

    function tryInitSpawn() {
      if (hasSpawned) return;
      const el = containerRef.current;
      // Container must have meaningful pixel dimensions (not hidden/mid-layout)
      if (!el || el.offsetWidth < 200 || el.offsetHeight < 50) {
        clearTimeout(settleTimer);
        settleTimer = null;
        return;
      }
      // Already waiting for settle
      if (settleTimer) return;
      // Wait 200ms for layout to fully stabilize before spawning
      settleTimer = setTimeout(() => {
        if (hasSpawned) return;
        const el2 = containerRef.current;
        if (!el2 || el2.offsetWidth < 200 || el2.offsetHeight < 50) {
          settleTimer = null;
          return;
        }
        hasSpawned = true;
        try { fitAddon.fit(); } catch {}
        trySpawn();
      }, 200);
    }

    requestAnimationFrame(tryInitSpawn);

    // Absolute fallback — if observer never fires, spawn after 5s
    const fallback = setTimeout(() => {
      if (!hasSpawned) {
        hasSpawned = true;
        try { fitAddon.fit(); } catch {}
        trySpawn();
      }
    }, 5000);

    const observer = new ResizeObserver(() => {
      if (!visibleRef.current) return;
      requestAnimationFrame(() => {
        if (!hasSpawned) {
          tryInitSpawn();
        } else {
          try { fitAddon.fit(); } catch {}
        }
      });
    });
    observer.observe(containerRef.current);

    return () => {
      clearTimeout(settleTimer);
      clearTimeout(fallback);
      observer.disconnect();
      if (handlerRef.current) {
        handlerRef.current.ws.removeEventListener('message', handlerRef.current.handler);
      }
      term.dispose();
      fitRef.current = null;
      termRef.current = null;
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible && fitRef.current) {
      requestAnimationFrame(() => {
        try { fitRef.current.fit(); } catch {}
      });
    }
  }, [visible]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden"
      style={{ display: visible ? 'block' : 'none' }}
    />
  );
}

export function TerminalManager() {
  const terminalVisible = useGrooveStore((s) => s.terminalVisible);
  const terminalHeight = useGrooveStore((s) => s.terminalHeight);
  const setTerminalVisible = useGrooveStore((s) => s.setTerminalVisible);
  const setTerminalHeight = useGrooveStore((s) => s.setTerminalHeight);

  const fullHeight = useGrooveStore((s) => s.terminalFullHeight);
  const setFullHeight = useGrooveStore((s) => s.setTerminalFullHeight);

  const [tabs, setTabs] = useState([{ id: 'term-0', label: 'Terminal' }]);
  const [activeTab, setActiveTab] = useState('term-0');
  const [selectedText, setSelectedText] = useState('');
  const killFns = useRef({});

  const registerKill = useCallback((tabId, fn) => { killFns.current[tabId] = fn; }, []);

  const addTab = useCallback(() => {
    tabCounter++;
    const id = `term-${tabCounter}`;
    setTabs((prev) => [...prev, { id, label: `Terminal ${tabCounter + 1}` }]);
    setActiveTab(id);
  }, []);

  const renameTab = useCallback((id, newLabel) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, label: newLabel } : t)));
  }, []);

  const closeTab = useCallback((id) => {
    killFns.current[id]?.();
    delete killFns.current[id];
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        setTerminalVisible(false);
        return prev;
      }
      if (activeTab === id) {
        const idx = prev.findIndex((t) => t.id === id);
        const newActive = next[Math.min(idx, next.length - 1)];
        setActiveTab(newActive.id);
      }
      return next;
    });
  }, [activeTab, setTerminalVisible]);

  return (
    <TerminalPanel
      visible={terminalVisible}
      height={terminalHeight}
      onHeightChange={setTerminalHeight}
      fullHeight={fullHeight}
      tabs={tabs}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      onAddTab={addTab}
      onCloseTab={closeTab}
      onRenameTab={renameTab}
      onToggleFullHeight={() => setFullHeight(true)}
      onMinimize={() => setFullHeight(false)}
      onClose={() => setTerminalVisible(false)}
      selectedText={selectedText}
    >
      {tabs.map((tab) => (
        <TerminalInstance
          key={tab.id}
          tabId={tab.id}
          visible={tab.id === activeTab}
          registerKill={registerKill}
          onSelectionChange={tab.id === activeTab ? setSelectedText : undefined}
        />
      ))}
    </TerminalPanel>
  );
}

export { TerminalManager as TerminalEmulator };
