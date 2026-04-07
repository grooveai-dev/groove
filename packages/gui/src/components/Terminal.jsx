// GROOVE GUI — Embedded Terminal (xterm.js)
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useRef, useEffect } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useGrooveStore } from '../stores/groove';

export default function Terminal({ visible }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const sessionIdRef = useRef(null);
  const spawnedRef = useRef(false);
  const ws = useGrooveStore((s) => s.ws);

  // Create xterm instance on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
      fontSize: 12,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: {
        background: '#1e2127',
        foreground: '#abb2bf',
        cursor: '#33afbc',
        selectionBackground: 'rgba(51, 175, 188, 0.25)',
        black: '#1e2127',
        red: '#e06c75',
        green: '#4ae168',
        yellow: '#e5c07b',
        blue: '#61afef',
        magenta: '#c678dd',
        cyan: '#33afbc',
        white: '#abb2bf',
        brightBlack: '#5c6370',
        brightRed: '#e06c75',
        brightGreen: '#4ae168',
        brightYellow: '#e5c07b',
        brightBlue: '#61afef',
        brightMagenta: '#c678dd',
        brightCyan: '#33afbc',
        brightWhite: '#e6e6e6',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(containerRef.current);

    // Fit after a frame so container has final dimensions
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch { /* ignore */ }
    });

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    return () => {
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      spawnedRef.current = false;
    };
  }, []);

  // Spawn shell session when ws + term are ready
  useEffect(() => {
    if (!ws || ws.readyState !== 1 || !termRef.current || spawnedRef.current) return;

    const term = termRef.current;
    spawnedRef.current = true;

    // Send spawn with initial dimensions
    ws.send(JSON.stringify({
      type: 'terminal:spawn',
      cols: term.cols || 120,
      rows: term.rows || 30,
    }));

    const handler = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'terminal:spawned') {
          sessionIdRef.current = msg.id;
        } else if (msg.type === 'terminal:output' && msg.id === sessionIdRef.current) {
          term.write(msg.data);
        } else if (msg.type === 'terminal:exit' && msg.id === sessionIdRef.current) {
          term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n');
          sessionIdRef.current = null;
        }
      } catch { /* ignore */ }
    };

    ws.addEventListener('message', handler);

    // Forward keystrokes
    const inputDisposable = term.onData((data) => {
      if (sessionIdRef.current && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'terminal:input', id: sessionIdRef.current, data }));
      }
    });

    // Forward resize events
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (sessionIdRef.current && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'terminal:resize', id: sessionIdRef.current, cols, rows }));
      }
    });

    return () => {
      ws.removeEventListener('message', handler);
      inputDisposable.dispose();
      resizeDisposable.dispose();
      if (sessionIdRef.current && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'terminal:kill', id: sessionIdRef.current }));
      }
      sessionIdRef.current = null;
      spawnedRef.current = false;
    };
  }, [ws]);

  // Refit on visibility change
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      const timer = setTimeout(() => {
        try { fitAddonRef.current.fit(); } catch { /* ignore */ }
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  // Refit on window resize
  useEffect(() => {
    const onResize = () => {
      if (fitAddonRef.current && visible) {
        try { fitAddonRef.current.fit(); } catch { /* ignore */ }
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [visible]);

  return (
    <div
      ref={containerRef}
      style={{
        ...styles.container,
        display: visible ? 'block' : 'none',
      }}
    />
  );
}

const styles = {
  container: {
    width: '100%', height: '100%',
    padding: '4px 0 0 4px',
    background: '#1e2127',
    overflow: 'hidden',
  },
};
