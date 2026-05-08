// GROOVE — Terminal PTY Manager (shell sessions over WebSocket)
// FSL-1.1-Apache-2.0 — see LICENSE

import { spawn, execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';

// Python helper that creates a real PTY and relays I/O through stdin/stdout pipes.
// The shell sees a genuine TTY — prompts, colors, line editing, tab completion all work.
const PTY_HELPER = `
import pty, os, sys, select, signal, struct, fcntl, termios, errno

master, slave = pty.openpty()

cols = int(os.environ.get('COLS', '120'))
rows = int(os.environ.get('ROWS', '30'))
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))

pid = os.fork()
if pid == 0:
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    os.dup2(slave, 0)
    os.dup2(slave, 1)
    os.dup2(slave, 2)
    os.close(master)
    os.close(slave)
    shell = os.environ.get('GROOVE_SHELL', os.environ.get('SHELL', '/bin/bash'))
    os.execvp(shell, [shell, '-l'])

os.close(slave)

def resize(sig, frame):
    pass
signal.signal(signal.SIGWINCH, resize)

flags = fcntl.fcntl(0, fcntl.F_GETFL)
fcntl.fcntl(0, fcntl.F_SETFL, flags | os.O_NONBLOCK)

ESC_START = b'\\x1b]7;'
ESC_END = b'\\x07'
stdin_buf = b''

try:
    while True:
        rlist = select.select([0, master], [], [], 0.05)[0]
        if 0 in rlist:
            try:
                data = os.read(0, 4096)
                if not data: break
                stdin_buf += data
            except OSError as e:
                if e.errno != errno.EAGAIN: break
        # Process buffered stdin — extract resize commands, forward the rest
        while stdin_buf:
            esc_pos = stdin_buf.find(ESC_START)
            if esc_pos == -1:
                os.write(master, stdin_buf)
                stdin_buf = b''
                break
            if esc_pos > 0:
                os.write(master, stdin_buf[:esc_pos])
                stdin_buf = stdin_buf[esc_pos:]
            bel_pos = stdin_buf.find(ESC_END)
            if bel_pos == -1:
                break
            params = stdin_buf[4:bel_pos].decode().split(';')
            if len(params) == 2:
                r, c = int(params[0]), int(params[1])
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
                os.kill(pid, signal.SIGWINCH)
            stdin_buf = stdin_buf[bel_pos+1:]
        if master in rlist:
            try:
                data = os.read(master, 4096)
                if not data: break
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
            except OSError: break
        # Check child
        try:
            p, status = os.waitpid(pid, os.WNOHANG)
            if p != 0: break
        except ChildProcessError: break
except: pass
finally:
    try: os.kill(pid, signal.SIGTERM)
    except: pass
`.trim();

export class TerminalManager {
  constructor(daemon) {
    this.daemon = daemon;
    this.sessions = new Map();
    this._python = this._findPython();
  }

  spawn(ws, options = {}) {
    const id = `term-${randomUUID()}`;
    const shell = this._detectShell();
    const cwd = options.cwd || this.daemon.projectDir;
    const cols = options.cols || 120;
    const rows = options.rows || 30;

    if (!this._python) {
      ws.send(JSON.stringify({
        type: 'terminal:output', id,
        data: '\r\n\x1b[31mTerminal requires Python 3 (python3 not found in PATH)\x1b[0m\r\n',
      }));
      ws.send(JSON.stringify({ type: 'terminal:exit', id, code: 1 }));
      return id;
    }

    const proc = spawn(this._python, ['-u', '-c', PTY_HELPER], {
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: process.env.LANG || 'en_US.UTF-8',
        GROOVE_SHELL: shell,
        COLS: String(cols),
        ROWS: String(rows),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session = { proc, ws, id, label: options.label || '' };
    this.sessions.set(id, session);

    proc.stdout.on('data', (data) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'terminal:output', id, data: data.toString('utf8') }));
      }
    });

    proc.stderr.on('data', (data) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'terminal:output', id, data: data.toString('utf8') }));
      }
    });

    proc.on('exit', (code) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'terminal:exit', id, code }));
      }
      this.sessions.delete(id);
    });

    proc.on('error', (err) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'terminal:output', id, data: `\r\nShell error: ${err.message}\r\n` }));
      }
      this.sessions.delete(id);
    });

    return id;
  }

  write(id, data) {
    const session = this.sessions.get(id);
    if (!session || !session.proc.stdin.writable) return;
    session.proc.stdin.write(data);
  }

  resize(id, rows, cols) {
    const session = this.sessions.get(id);
    if (!session || !session.proc.stdin.writable) return;
    // Send resize command via the custom escape sequence
    session.proc.stdin.write(`\x1b]7;${rows};${cols}\x07`);
  }

  rename(id, label) {
    const session = this.sessions.get(id);
    if (!session) return false;
    if (typeof label !== 'string' || label.length > 100) return false;
    session.label = label;
    return true;
  }

  kill(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    try {
      session.proc.kill('SIGTERM');
      setTimeout(() => {
        try { session.proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, 1000);
    } catch { /* already dead */ }
    this.sessions.delete(id);
  }

  killAll() {
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }

  cleanupClient(ws) {
    for (const [id, session] of this.sessions) {
      if (session.ws === ws) {
        this.kill(id);
      }
    }
  }

  _detectShell() {
    if (process.env.SHELL && existsSync(process.env.SHELL)) return process.env.SHELL;
    for (const sh of ['/bin/zsh', '/bin/bash', '/bin/sh']) {
      if (existsSync(sh)) return sh;
    }
    return 'sh';
  }

  _findPython() {
    for (const cmd of ['python3', 'python']) {
      try {
        const v = execFileSync(cmd, ['--version'], { encoding: 'utf8', timeout: 3000 }).trim();
        if (v.startsWith('Python 3')) return cmd;
      } catch { /* not found */ }
    }
    return null;
  }
}
