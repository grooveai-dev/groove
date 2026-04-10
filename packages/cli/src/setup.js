// GROOVE CLI — Interactive First-Run Setup Wizard
// FSL-1.1-Apache-2.0 — see LICENSE

import { createInterface } from 'readline';
import { execSync, execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

const rl = () => createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt) {
  return new Promise((resolve) => {
    const r = rl();
    r.question(prompt, (answer) => { r.close(); resolve(answer.trim()); });
  });
}

function askMasked(prompt) {
  return new Promise((resolve) => {
    const r = rl();
    r.question(prompt, (answer) => { r.close(); resolve(answer.trim()); });
    r._writeToOutput = function (str) {
      if (str.includes('\n') || str.includes('\r')) {
        r.output.write('\n');
      } else {
        r.output.write('*');
      }
    };
  });
}

/**
 * Interactive checkbox selector — arrow keys to navigate, space to toggle, enter to confirm.
 */
function selectMultiple(items, { message = '', startLine = 0 } = {}) {
  return new Promise((resolvePromise) => {
    const selected = new Set();
    let cursor = 0;

    function render() {
      // Move cursor up to overwrite previous render
      if (startLine > 0) process.stdout.write(`\x1b[${items.length + 2}A`);

      if (message) console.log(message);

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const isSelected = selected.has(i);
        const isCursor = i === cursor;

        const checkbox = isSelected ? chalk.cyan('◉') : chalk.dim('○');
        const pointer = isCursor ? chalk.cyan('▸ ') : '  ';
        const label = isCursor ? chalk.bold(item.label) : item.label;
        const hint = item.hint ? chalk.dim(` — ${item.hint}`) : '';
        const tag = item.tag ? ` ${item.tag}` : '';

        console.log(`  ${pointer}${checkbox} ${label}${tag}${hint}`);
      }
      console.log(chalk.dim('  ↑↓ navigate  ␣ toggle  ⏎ confirm'));
    }

    // Initial render
    render();
    startLine = 1; // After first render, always overwrite

    const { stdin } = process;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    function onKey(key) {
      // Ctrl+C
      if (key === '\x03') {
        stdin.setRawMode(false);
        stdin.removeListener('data', onKey);
        stdin.pause();
        process.exit(0);
      }

      // Enter — confirm
      if (key === '\r' || key === '\n') {
        stdin.setRawMode(false);
        stdin.removeListener('data', onKey);
        stdin.pause();
        // Clear the hint line
        process.stdout.write(`\x1b[${items.length + 2}A`);
        // Final render with confirmed state
        if (message) console.log(message);
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const isSelected = selected.has(i);
          const checkbox = isSelected ? chalk.green('✓') : chalk.dim('·');
          const label = isSelected ? chalk.bold(item.label) : chalk.dim(item.label);
          console.log(`   ${checkbox} ${label}`);
        }
        const count = selected.size;
        console.log(count > 0 ? chalk.green(`  ${count} selected`) : chalk.dim('  none selected — skipped'));
        resolvePromise([...selected].map((i) => items[i]));
        return;
      }

      // Space — toggle
      if (key === ' ') {
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
        render();
        return;
      }

      // Arrow up
      if (key === '\x1b[A' || key === 'k') {
        cursor = (cursor - 1 + items.length) % items.length;
        render();
        return;
      }

      // Arrow down
      if (key === '\x1b[B' || key === 'j') {
        cursor = (cursor + 1) % items.length;
        render();
        return;
      }

      // 'a' — select all
      if (key === 'a') {
        if (selected.size === items.length) selected.clear();
        else items.forEach((_, i) => selected.add(i));
        render();
      }
    }

    stdin.on('data', onKey);
  });
}

function cmd(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch { return null; }
}

function isInstalled(name) {
  try {
    execFileSync('which', [name], { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

const PROVIDERS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    cli: 'claude',
    install: 'npm i -g @anthropic-ai/claude-code',
    auth: 'subscription',
    description: 'Anthropic\'s CLI agent — subscription auth',
    recommended: true,
  },
  {
    id: 'codex',
    name: 'Codex',
    cli: 'codex',
    install: 'npm i -g @openai/codex',
    auth: 'api-key',
    envKey: 'OPENAI_API_KEY',
    description: 'OpenAI\'s coding agent — API key required',
    keyHelp: 'Get your key at https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    cli: 'gemini',
    install: 'npm i -g @google/gemini-cli',
    auth: 'api-key',
    envKey: 'GEMINI_API_KEY',
    description: 'Google\'s coding agent — API key required',
    keyHelp: 'Get your key at https://aistudio.google.com/apikey',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    cli: 'ollama',
    install: process.platform === 'darwin' ? 'brew install ollama' : 'See https://ollama.ai/download',
    auth: 'local',
    description: 'Run models locally — no API key, no cloud',
  },
];

export async function runSetupWizard() {
  const version = getVersion();

  console.log('');
  console.log(chalk.bold('  ┌──────────────────────────────────────────┐'));
  console.log(chalk.bold('  │') + '                                            ' + chalk.bold('│'));
  console.log(chalk.bold('  │') + '           ' + chalk.bold.cyan('G R O O V E') + '                   ' + chalk.bold('│'));
  console.log(chalk.bold('  │') + '    Agent Orchestration Layer          ' + chalk.bold('│'));
  console.log(chalk.bold('  │') + '                                            ' + chalk.bold('│'));
  console.log(chalk.bold('  │') + chalk.dim(`    v${version}`) + ' '.repeat(Math.max(0, 37 - version.length)) + chalk.bold('│'));
  console.log(chalk.bold('  └──────────────────────────────────────────┘'));
  console.log('');
  console.log(chalk.dim('  First time? Let\'s get you set up in under a minute.'));
  console.log('');

  // ── Step 1: System check ────────────────────────────────────
  console.log(chalk.bold.cyan('  ① ') + chalk.bold('System Check'));
  console.log('');

  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1), 10);
  if (nodeMajor >= 20) {
    console.log(chalk.green('  ✓') + ` Node.js ${nodeVersion}`);
  } else {
    console.log(chalk.red('  ✗') + ` Node.js ${nodeVersion} — Groove requires Node.js 20+`);
    console.log(chalk.dim('    Install the latest: https://nodejs.org'));
    process.exit(1);
  }

  const npmVersion = cmd('npm --version');
  if (npmVersion) {
    console.log(chalk.green('  ✓') + ` npm ${npmVersion}`);
  } else {
    console.log(chalk.red('  ✗') + ' npm not found');
    process.exit(1);
  }

  if (isInstalled('git')) {
    console.log(chalk.green('  ✓') + ` git ${cmd('git --version')?.replace('git version ', '') || ''}`);
  } else {
    console.log(chalk.yellow('  !') + ' git not found — agents may need it for version control');
  }

  console.log('');

  // ── Step 2: Provider scan ───────────────────────────────────
  console.log(chalk.bold.cyan('  ② ') + chalk.bold('AI Providers'));
  console.log('');

  const installed = [];
  const available = [];

  for (const p of PROVIDERS) {
    if (isInstalled(p.cli)) {
      installed.push(p);
      const rec = p.recommended ? chalk.cyan(' recommended') : '';
      console.log(chalk.green('  ✓') + ` ${p.name}${rec}`);
    } else {
      available.push(p);
    }
  }

  if (installed.length > 0 && available.length > 0) console.log('');

  // ── Step 3: Install missing providers ───────────────────────
  if (available.length > 0) {
    const items = available.map((p) => ({
      label: p.name,
      hint: p.description,
      tag: p.recommended ? chalk.cyan('recommended') : '',
      provider: p,
    }));

    const selected = await selectMultiple(items, {
      message: chalk.dim('  Select providers to install:'),
    });

    if (selected.length > 0) {
      console.log('');
      for (const item of selected) {
        const p = item.provider;
        process.stdout.write(`  Installing ${chalk.bold(p.name)}...`);
        try {
          execSync(p.install, { stdio: ['pipe', 'pipe', 'pipe'] });
          process.stdout.write(chalk.green(' done\n'));
          installed.push(p);
        } catch {
          process.stdout.write(chalk.red(' failed\n'));
          console.log(chalk.dim(`    Try manually: ${p.install}`));
        }
      }
    }
  }

  if (installed.length === 0) {
    console.log('');
    console.log(chalk.yellow('  No providers installed.'));
    console.log(chalk.dim('  You\'ll need at least one to spawn agents.'));
    console.log(chalk.dim('  Recommended: npm i -g @anthropic-ai/claude-code'));
    console.log('');
    const cont = await ask(chalk.bold('  Continue anyway? ') + chalk.dim('[Y/n] '));
    if (cont.toLowerCase() === 'n') {
      console.log(chalk.dim('  Run `groove start` again after installing a provider.'));
      process.exit(0);
    }
  }

  console.log('');

  // ── Step 4: API key setup ───────────────────────────────────
  const needsKey = installed.filter((p) => p.auth === 'api-key');
  const keys = {};

  if (needsKey.length > 0) {
    console.log(chalk.bold.cyan('  ③ ') + chalk.bold('API Keys'));
    console.log('');

    for (const p of needsKey) {
      console.log(`  ${chalk.bold(p.name)} requires an API key.`);
      if (p.keyHelp) console.log(chalk.dim(`  ${p.keyHelp}`));

      const key = await askMasked(`  Enter key ${chalk.dim('(or Enter to skip)')}: `);
      if (key) {
        keys[p.id] = key;
        console.log(chalk.green(`  ✓ saved`));
      } else {
        console.log(chalk.dim(`  Skipped — set later: groove set-key ${p.id} <key>`));
      }
      console.log('');
    }
  }

  // ── Step 5: Claude Code auth check ──────────────────────────
  const hasClaude = installed.some((p) => p.id === 'claude-code');
  if (hasClaude) {
    const stepNum = needsKey.length > 0 ? '④' : '③';
    console.log(chalk.bold.cyan(`  ${stepNum} `) + chalk.bold('Claude Code'));
    console.log('');
    console.log(chalk.dim('  Uses your Anthropic subscription — no API key needed.'));

    try {
      const out = cmd('claude --version');
      if (out) console.log(chalk.green('  ✓') + ` Claude Code ${out}`);
    } catch { /* ignore */ }

    console.log(chalk.dim('  If not logged in yet, run `claude` to authenticate.'));
    console.log('');
  }

  // ── Done ───────────────────────────────────────────────────
  console.log(chalk.bold('  ─────────────────────────────────────────'));
  console.log('');
  console.log(chalk.bold.cyan('  Ready to go!'));
  console.log('');
  console.log(`  Providers  ${installed.map((p) => chalk.bold(p.name)).join(chalk.dim(', ')) || chalk.dim('none')}`);
  if (Object.keys(keys).length > 0) {
    console.log(`  Keys       ${Object.keys(keys).map((k) => chalk.bold(PROVIDERS.find((p) => p.id === k)?.name || k)).join(chalk.dim(', '))}`);
  }
  console.log(`  Dashboard  ${chalk.cyan('http://localhost:31415')}`);
  console.log(`  Docs       ${chalk.dim('https://docs.groovedev.ai')}`);
  console.log('');
  console.log(chalk.dim('  Starting daemon...'));
  console.log('');

  return { installed, keys };
}

/**
 * After the daemon is running, save API keys via the credential store.
 */
export async function saveKeysViaDaemon(keys, port = 31415) {
  for (const [provider, key] of Object.entries(keys)) {
    try {
      const res = await fetch(`http://localhost:${port}/api/credentials/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      console.log(chalk.yellow(`  Warning: Could not save ${provider} key: ${err.message}`));
    }
  }
}
