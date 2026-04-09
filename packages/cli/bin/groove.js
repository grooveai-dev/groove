#!/usr/bin/env node

// GROOVE CLI — Entry Point
// FSL-1.1-Apache-2.0 — see LICENSE

import { program } from 'commander';
import { start } from '../src/commands/start.js';
import { stop } from '../src/commands/stop.js';
import { spawn } from '../src/commands/spawn.js';
import { kill } from '../src/commands/kill.js';
import { agents } from '../src/commands/agents.js';
import { status } from '../src/commands/status.js';
import { nuke } from '../src/commands/nuke.js';
import { rotate } from '../src/commands/rotate.js';
import { teamCreate, teamSave, teamLoad, teamList, teamDelete, teamRename, teamExport, teamImport } from '../src/commands/team.js';
import { approvals, approve, reject } from '../src/commands/approve.js';
import { providers, setKey } from '../src/commands/providers.js';
import { configShow, configSet } from '../src/commands/config.js';
import { connect } from '../src/commands/connect.js';
import { disconnect } from '../src/commands/disconnect.js';
import { audit } from '../src/commands/audit.js';
import { federationPair, federationUnpair, federationList, federationStatus } from '../src/commands/federation.js';

program
  .name('groove')
  .description('Agent orchestration layer for AI coding tools')
  .version('0.19.6');

program
  .command('start')
  .description('Start the GROOVE daemon')
  .option('-p, --port <port>', 'Port to run on', '31415')
  .option('-H, --host <host>', 'Host/IP to bind to (use "tailscale" for auto-detect)', '127.0.0.1')
  .action(start);

program
  .command('stop')
  .description('Stop the GROOVE daemon')
  .action(stop);

program
  .command('spawn')
  .description('Spawn a new AI agent')
  .option('-r, --role <role>', 'Agent role (e.g., backend, frontend, devops)')
  .option('-s, --scope <patterns...>', 'File scope patterns')
  .option('-p, --provider <provider>', 'AI provider', 'claude-code')
  .option('-m, --model <model>', 'Model to use')
  .option('--prompt <prompt>', 'Initial prompt for the agent')
  .action(spawn);

program
  .command('kill <id>')
  .description('Kill a running agent')
  .action(kill);

program
  .command('agents')
  .description('List all agents')
  .action(agents);

program
  .command('status')
  .description('Show daemon status')
  .action(status);

program
  .command('nuke')
  .description('Kill all agents and stop the daemon')
  .action(nuke);

program
  .command('rotate <id>')
  .description('Rotate an agent (kill + respawn with fresh context)')
  .action(rotate);

// Teams
const team = program.command('team').description('Manage agent teams');
team.command('create <name>').description('Create a new team').action(teamCreate);
team.command('save <name>').description('Create a new team (alias)').action(teamSave);
team.command('list').description('List teams').action(teamList);
team.command('delete <id>').description('Delete a team by ID').action(teamDelete);
team.command('rename <id> <name>').description('Rename a team').action(teamRename);
team.command('load <name>').description('(deprecated)').action(teamLoad);
team.command('export <name>').description('(deprecated)').action(teamExport);
team.command('import <file>').description('(deprecated)').action(teamImport);

// Approvals
program.command('approvals').description('List pending approvals').action(approvals);
program.command('approve <id>').description('Approve a pending request').action(approve);
program
  .command('reject <id>')
  .description('Reject a pending request')
  .option('--reason <reason>', 'Rejection reason')
  .action(reject);

// Providers
program.command('providers').description('List available AI providers').action(providers);
program.command('set-key <provider> <key>').description('Set API key for a provider').action(setKey);

// Remote
program
  .command('connect <target>')
  .description('Connect to a remote GROOVE daemon via SSH tunnel')
  .option('-i, --identity <keyfile>', 'SSH private key file')
  .option('--no-browser', 'Don\'t open browser automatically')
  .action(connect);

program
  .command('disconnect')
  .description('Disconnect from remote GROOVE daemon')
  .action(disconnect);

// Audit
program
  .command('audit')
  .description('View audit log of state-changing operations')
  .option('-n, --limit <count>', 'Number of entries to show', '25')
  .action(audit);

// Federation
const federation = program.command('federation').description('Manage daemon-to-daemon federation');
federation.command('pair <target>').description('Pair with a remote GROOVE daemon (ip or ip:port)').action(federationPair);
federation.command('unpair <id>').description('Remove a paired peer').action(federationUnpair);
federation.command('list').description('List paired peers').action(federationList);
federation.command('status').description('Show federation status').action(federationStatus);

// Config
const config = program.command('config').description('View and modify configuration');
config.command('show').description('Show current configuration').action(configShow);
config.command('set <key> <value>').description('Set a configuration value').action(configSet);

program.parse();
