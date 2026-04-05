// GROOVE CLI — spawn command
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { createInterface } from 'readline';
import { apiCall } from '../client.js';

const ROLE_PRESETS = {
  backend:  { scope: ['src/api/**', 'src/server/**', 'src/lib/**', 'src/db/**'] },
  frontend: { scope: ['src/components/**', 'src/views/**', 'src/pages/**', 'src/styles/**'] },
  devops:   { scope: ['Dockerfile*', 'docker-compose*', '.github/**', 'infra/**'] },
  testing:  { scope: ['tests/**', 'test/**', '**/*.test.*', '**/*.spec.*'] },
  docs:     { scope: ['docs/**', '*.md', 'README*'] },
  fullstack: { scope: [] },
};

export async function spawn(options) {
  // If no role specified, run interactive picker
  if (!options.role) {
    return interactiveSpawn();
  }

  try {
    const config = {
      role: options.role,
      scope: options.scope || ROLE_PRESETS[options.role]?.scope || [],
      provider: options.provider || 'claude-code',
      model: options.model || null,
      prompt: options.prompt || null,
    };

    const agent = await apiCall('POST', '/api/agents', config);

    console.log('');
    console.log(chalk.green('  Agent spawned'));
    console.log(`  Name:     ${chalk.bold(agent.name)}`);
    console.log(`  ID:       ${chalk.dim(agent.id)}`);
    console.log(`  Role:     ${agent.role}`);
    console.log(`  Provider: ${agent.provider}`);
    console.log(`  Scope:    ${agent.scope.length > 0 ? agent.scope.join(', ') : chalk.dim('unrestricted')}`);
    if (agent.prompt) {
      console.log(`  Prompt:   ${agent.prompt.slice(0, 60)}${agent.prompt.length > 60 ? '...' : ''}`);
    }
    console.log('');
  } catch (err) {
    console.error(chalk.red('Failed to spawn:'), err.message);
    process.exit(1);
  }
}

async function interactiveSpawn() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  console.log('');
  console.log(chalk.bold('  GROOVE — Spawn Agent'));
  console.log('');
  console.log('  Available roles:');
  for (const [role, preset] of Object.entries(ROLE_PRESETS)) {
    const scope = preset.scope.length > 0 ? chalk.dim(preset.scope.join(', ')) : chalk.dim('unrestricted');
    console.log(`    ${chalk.bold(role.padEnd(12))} ${scope}`);
  }
  console.log('');

  const role = await ask('  Role: ');
  if (!role.trim()) {
    console.log(chalk.yellow('  Cancelled.'));
    rl.close();
    return;
  }

  const prompt = await ask('  Task prompt (optional): ');
  rl.close();

  const config = {
    role: role.trim(),
    scope: ROLE_PRESETS[role.trim()]?.scope || [],
    provider: 'claude-code',
    prompt: prompt.trim() || null,
  };

  try {
    const agent = await apiCall('POST', '/api/agents', config);
    console.log('');
    console.log(chalk.green(`  Spawned ${chalk.bold(agent.name)}`), chalk.dim(`(${agent.id})`));
    console.log('');
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}
