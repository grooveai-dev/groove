// GROOVE CLI — team commands
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { readFileSync } from 'fs';
import { apiCall } from '../client.js';

export async function teamSave(name) {
  try {
    const team = await apiCall('POST', '/api/teams', { name });
    console.log(chalk.green(`  Saved team "${team.name}"`) + ` (${team.agents.length} agents)`);
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}

export async function teamLoad(name) {
  try {
    console.log(chalk.yellow(`  Loading team "${name}"...`));
    const result = await apiCall('POST', `/api/teams/${encodeURIComponent(name)}/load`);
    console.log(chalk.green(`  Loaded "${name}"`), `— ${result.agents.length} agents spawned`);
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}

export async function teamList() {
  try {
    const { teams, activeTeam } = await apiCall('GET', '/api/teams');
    if (teams.length === 0) {
      console.log(chalk.dim('  No saved teams. Use `groove team save "name"` to create one.'));
      return;
    }
    console.log(chalk.bold(`\n  Saved Teams (${teams.length})\n`));
    for (const t of teams) {
      const active = t.name === activeTeam ? chalk.green(' (active)') : '';
      console.log(`  ${chalk.bold(t.name)}${active}  — ${t.agents} agents — saved ${new Date(t.updatedAt).toLocaleDateString()}`);
    }
    console.log('');
  } catch {
    console.error(chalk.red('  Cannot connect to daemon.'));
    process.exit(1);
  }
}

export async function teamDelete(name) {
  try {
    await apiCall('DELETE', `/api/teams/${encodeURIComponent(name)}`);
    console.log(chalk.green(`  Deleted team "${name}"`));
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}

export async function teamExport(name) {
  try {
    const data = await apiCall('GET', `/api/teams/${encodeURIComponent(name)}/export`);
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}

export async function teamImport(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const team = await apiCall('POST', '/api/teams/import', JSON.parse(content));
    console.log(chalk.green(`  Imported team "${team.name}"`), `(${team.agents.length} agents)`);
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}
