// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useGrooveStore } from '../../stores/groove';
import { TerminalPanel } from '../layout/terminal-panel';

const THEME = {
  background: '#1a1e25',
  foreground: '#bcc2cd',
  cursor: '#33afbc',
  cursorAccent: '#1a1e25',
  selectionBackground: 'rgba(51, 175, 188, 0.25)',
  black: '#1a1e25', red: '#e06c75', green: '#4ae168', yellow: '#e5c07b',
  blue: '#61afef', magenta: '#c678dd', cyan: '#33afbc', white: '#bcc2cd',
  brightBlack: '#505862', brightRed: '#e06c75', brightGreen: '#4ae168', brightYellow: '#e5c07b',
  brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#33afbc', brightWhite: '#e6e6e6',
};

let tabCounter = 0;

function TerminalInstance({ tabId, visible }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);
  const termIdRef = useRef(null);
  const handlerRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return;
    mountedRef.current = true;

    const term = new XTerm({
      theme: THEME,
      fontFamily: "'JetBrains Mono Variable', 'SF Mono', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    termRef.current = term;
    fitRef.current = fitAddon;

    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
    });

    let spawnAttempts = 0;
    function trySpawn() {
      spawnAttempts++;
      const ws = useGrooveStore.getState().ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        if (spawnAttempts < 20) setTimeout(trySpawn, 500);
        return;
      }

      ws.send(JSON.stringify({ type: 'terminal:spawn', cols: term.cols, rows: term.rows }));

      function onMessage(event) {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'terminal:spawned' && !termIdRef.current) {
          termIdRef.current = msg.id;
        } else if (msg.type === 'terminal:output' && msg.id === termIdRef.current) {
          term.write(msg.data);
        } else if (msg.type === 'terminal:exit' && msg.id === termIdRef.current) {
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

      term.onResize(({ cols, rows }) => {
        const ws = useGrooveStore.getState().ws;
        if (ws?.readyState === WebSocket.OPEN && termIdRef.current) {
          ws.send(JSON.stringify({ type: 'terminal:resize', id: termIdRef.current, rows, cols }));
        }
      });
    }

    trySpawn();

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => { try { fitAddon.fit(); } catch {} });
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      const ws = useGrooveStore.getState().ws;
      if (ws?.readyState === WebSocket.OPEN && termIdRef.current) {
        ws.send(JSON.stringify({ type: 'terminal:kill', id: termIdRef.current }));
      }
      if (handlerRef.current) {
        handlerRef.current.ws.removeEventListener('message', handlerRef.current.handler);
      }
      term.dispose();
      fitRef.current = null;
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
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

  const addTab = useCallback(() => {
    tabCounter++;
    const id = `term-${tabCounter}`;
    setTabs((prev) => [...prev, { id, label: `Terminal ${tabCounter + 1}` }]);
    setActiveTab(id);
  }, []);

  const closeTab = useCallback((id) => {
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
      onToggleFullHeight={() => setFullHeight(true)}
      onMinimize={() => setFullHeight(false)}
    >
      {tabs.map((tab) => (
        <TerminalInstance key={tab.id} tabId={tab.id} visible={tab.id === activeTab} />
      ))}
    </TerminalPanel>
  );
}

// Keep backward-compat export for existing imports
export { TerminalManager as TerminalEmulator };
