// GROOVE CLI — Interactive First-Run Setup Wizard
// FSL-1.1-Apache-2.0 — see LICENSE

import { createInterface } from 'readline';
import { execSync, execFileSync } from 'child_process';
import chalk from 'chalk';

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
    // Mask input by overwriting with *
    r._writeToOutput = function (str) {
      if (str.includes('\n') || str.includes('\r')) {
        r.output.write('\n');
      } else {
        r.output.write('*');
      }
    };
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
    description: 'Anthropic\'s CLI agent. Uses your Claude subscription (no API key needed).',
    recommended: true,
  },
  {
    id: 'codex',
    name: 'Codex',
    cli: 'codex',
    install: 'npm i -g @openai/codex',
    auth: 'api-key',
    envKey: 'OPENAI_API_KEY',
    description: 'OpenAI\'s coding agent. Requires an OpenAI API key.',
    keyHelp: 'Get your key at https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    cli: 'gemini',
    install: 'npm i -g @google/gemini-cli',
    auth: 'api-key',
    envKey: 'GEMINI_API_KEY',
    description: 'Google\'s coding agent. Requires a Gemini API key.',
    keyHelp: 'Get your key at https://aistudio.google.com/apikey',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    cli: 'ollama',
    install: process.platform === 'darwin' ? 'brew install ollama' : 'See https://ollama.ai/download',
    auth: 'local',
    description: 'Run models locally. No API key, no cloud. Requires 8GB+ RAM.',
  },
];

export async function runSetupWizard() {
  console.log('');
  console.log(chalk.bold('  ┌──────────────────────────────────────────┐'));
  console.log(chalk.bold('  │') + '          Welcome to ' + chalk.bold.cyan('GROOVE') + '                ' + chalk.bold('│'));
  console.log(chalk.bold('  │') + '    Agent orchestration for AI coding      ' + chalk.bold('│'));
  console.log(chalk.bold('  └──────────────────────────────────────────┘'));
  console.log('');
  console.log(chalk.dim('  Let\'s get you set up. This takes about a minute.'));
  console.log('');

  // ── Step 1: System check ────────────────────────────────────
  console.log(chalk.bold('  1. System Check'));
  console.log('');

  // Node.js
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.slice(1), 10);
  if (nodeMajor >= 20) {
    console.log(chalk.green('  ✓') + ` Node.js ${nodeVersion}`);
  } else {
    console.log(chalk.red('  ✗') + ` Node.js ${nodeVersion} — Groove requires Node.js 20+`);
    console.log(chalk.dim('    Install the latest: https://nodejs.org'));
    process.exit(1);
  }

  // npm
  const npmVersion = cmd('npm --version');
  if (npmVersion) {
    console.log(chalk.green('  ✓') + ` npm ${npmVersion}`);
  } else {
    console.log(chalk.red('  ✗') + ' npm not found');
    process.exit(1);
  }

  // git
  if (isInstalled('git')) {
    console.log(chalk.green('  ✓') + ` git ${cmd('git --version')?.replace('git version ', '') || ''}`);
  } else {
    console.log(chalk.yellow('  !') + ' git not found — agents may need it for version control');
    console.log(chalk.dim('    Install: https://git-scm.com'));
  }

  console.log('');

  // ── Step 2: Provider scan ───────────────────────────────────
  console.log(chalk.bold('  2. AI Providers'));
  console.log('');

  const installed = [];
  const available = [];

  for (const p of PROVIDERS) {
    if (isInstalled(p.cli)) {
      installed.push(p);
      const rec = p.recommended ? chalk.cyan(' (recommended)') : '';
      console.log(chalk.green('  ✓') + ` ${p.name}${rec}`);
    } else {
      available.push(p);
    }
  }

  if (installed.length > 0 && available.length > 0) {
    console.log('');
  }

  // ── Step 3: Install missing providers ───────────────────────
  if (available.length > 0) {
    console.log(chalk.dim('  Available to install:'));
    available.forEach((p, i) => {
      const rec = p.recommended ? chalk.cyan(' (recommended)') : '';
      console.log(`  ${chalk.bold(i + 1)}. ${p.name}${rec} — ${p.description}`);
    });
    console.log(`  ${chalk.bold('0')}. Skip — I'll install later`);
    console.log('');

    const answer = await ask(chalk.bold('  Which providers would you like to install? ') + chalk.dim('(e.g. 1,2 or 0 to skip) '));
    const selections = answer.split(/[,\s]+/).map((s) => parseInt(s, 10)).filter((n) => n > 0 && n <= available.length);

    if (selections.length > 0) {
      console.log('');
      for (const idx of selections) {
        const p = available[idx - 1];
        console.log(`  Installing ${chalk.bold(p.name)}...`);
        try {
          execSync(p.install, { stdio: 'inherit' });
          console.log(chalk.green(`  ✓ ${p.name} installed`));
          installed.push(p);
        } catch {
          console.log(chalk.red(`  ✗ ${p.name} failed to install`));
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
    console.log(chalk.bold('  3. API Keys'));
    console.log('');

    for (const p of needsKey) {
      console.log(`  ${chalk.bold(p.name)} requires an API key.`);
      if (p.keyHelp) console.log(chalk.dim(`  ${p.keyHelp}`));

      const key = await askMasked(`  Enter ${p.name} API key ${chalk.dim('(or press Enter to skip)')}: `);
      if (key) {
        keys[p.id] = key;
        console.log(chalk.green(`  ✓ ${p.name} key saved`));
      } else {
        console.log(chalk.dim(`  Skipped — set it later in Settings or: groove set-key ${p.id} <key>`));
      }
      console.log('');
    }
  }

  // ── Step 5: Claude Code auth check ──────────────────────────
  const hasClaude = installed.some((p) => p.id === 'claude-code');
  if (hasClaude) {
    console.log(chalk.bold(`  ${needsKey.length > 0 ? '4' : '3'}. Claude Code Auth`));
    console.log('');
    console.log(chalk.dim('  Claude Code uses your Anthropic subscription (not API keys).'));
    console.log(chalk.dim('  If you haven\'t logged in yet, run `claude` in a terminal to authenticate.'));

    // Quick check if claude is authenticated
    try {
      const out = cmd('claude --version');
      if (out) {
        console.log(chalk.green('  ✓') + ` Claude Code ${out} installed`);
      }
    } catch { /* ignore */ }
    console.log('');
  }

  // ── Done! ──────────────────────────────────────────────────
  console.log(chalk.bold('  Setup complete!'));
  console.log('');
  console.log(`  Providers: ${installed.map((p) => p.name).join(', ') || 'none'}`);
  if (Object.keys(keys).length > 0) {
    console.log(`  Keys configured: ${Object.keys(keys).map((k) => PROVIDERS.find((p) => p.id === k)?.name || k).join(', ')}`);
  }
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
