// GROOVE CLI — team commands
// FSL-1.1-Apache-2.0 — see LICENSE

import { createInterface } from 'readline';
import chalk from 'chalk';
import { apiCall } from '../client.js';

function confirm(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => { rl.close(); resolve(answer.trim().toLowerCase() === 'y'); });
  });
}

export async function teamCreate(name) {
  try {
    const team = await apiCall('POST', '/api/teams', { name });
    console.log(chalk.green(`  Created team "${team.name}"`) + ` (id: ${team.id})`);
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}

// Backward compat alias
export const teamSave = teamCreate;

export async function teamList() {
  try {
    const { teams, defaultTeamId } = await apiCall('GET', '/api/teams');
    if (teams.length === 0) {
      console.log(chalk.dim('  No teams. Use `groove team create "name"` to create one.'));
      return;
    }
    console.log(chalk.bold(`\n  Teams (${teams.length})\n`));
    for (const t of teams) {
      const isDefault = t.id === defaultTeamId ? chalk.green(' (default)') : '';
      console.log(`  ${chalk.bold(t.name)}${isDefault}  — id: ${t.id} — created ${new Date(t.createdAt).toLocaleDateString()}`);
    }
    console.log('');
  } catch {
    console.error(chalk.red('  Cannot connect to daemon.'));
    process.exit(1);
  }
}

export async function teamDelete(id) {
  const ok = await confirm(`  This will archive the team directory. Continue? [y/N] `);
  if (!ok) {
    console.log(chalk.dim('  Cancelled.'));
    return;
  }
  try {
    await apiCall('DELETE', `/api/teams/${encodeURIComponent(id)}`);
    console.log(chalk.green(`  Archived team "${id}"`) + chalk.dim(' — restore with `groove team restore <id>`'));
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}

export async function teamArchived() {
  try {
    const { archived } = await apiCall('GET', '/api/teams/archived');
    if (archived.length === 0) {
      console.log(chalk.dim('  No archived teams.'));
      return;
    }
    console.log(chalk.bold(`\n  Archived Teams (${archived.length})\n`));
    for (const t of archived) {
      const date = t.deletedAt ? new Date(t.deletedAt).toLocaleDateString() : 'unknown';
      console.log(`  ${chalk.bold(t.originalName || t.id)}  — archive-id: ${t.id} — deleted ${date} — ${t.agentCount} agent(s)`);
    }
    console.log('');
  } catch {
    console.error(chalk.red('  Cannot connect to daemon.'));
    process.exit(1);
  }
}

export async function teamRestore(id) {
  try {
    const team = await apiCall('POST', `/api/teams/archived/${encodeURIComponent(id)}/restore`);
    console.log(chalk.green(`  Restored team "${team.name}"`) + ` (new id: ${team.id})`);
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}

export async function teamRename(id, name) {
  try {
    const team = await apiCall('PATCH', `/api/teams/${encodeURIComponent(id)}`, { name });
    console.log(chalk.green(`  Renamed to "${team.name}"`));
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}

// Stubs for removed commands (old API)
export async function teamLoad() {
  console.log(chalk.yellow('  Teams are now live organizational groups. No need to "load" — agents persist in their teams.'));
  console.log(chalk.dim('  Use `groove team list` to see your teams, `groove team create` to add one.'));
}

export async function teamExport() {
  console.log(chalk.yellow('  Team export has been removed. Teams are now live groups, not saved configurations.'));
}

export async function teamImport() {
  console.log(chalk.yellow('  Team import has been removed. Teams are now live groups, not saved configurations.'));
}
