// GROOVE CLI — InnerChat ask/tell/who
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Agent-to-agent messaging as first-class CLI verbs.
//
// The HTTP endpoints came first, and agents were taught them via a curl
// snippet in the spawn prompt. That decays: on a long session the snippet
// scrolls out of context and the agent no longer knows the capability exists,
// or half-remembers it and reaches for a built-in tool that cannot see GROOVE
// agents. A CLI verb survives that — an agent that has forgotten the details
// can still run `groove --help` or simply guess `groove ask`, and the command
// itself explains the rest.

import chalk from 'chalk';
import { apiCall } from '../client.js';

// The caller is almost always an agent, and the daemon injects its identity
// into the environment — so `--from` is a manual override, not a requirement.
function resolveFrom(opts) {
  const from = opts.from || process.env.GROOVE_AGENT_NAME;
  if (!from) {
    console.error(chalk.red('  Could not tell who is asking.'));
    console.error(chalk.dim('  Pass --from <your-agent-name> (GROOVE_AGENT_NAME is unset — are you running outside an agent?)'));
    process.exit(1);
  }
  return from;
}

function reportError(err, to) {
  console.error(chalk.red('  Failed:'), err.message);
  // The daemon returns actionable bodies (unknown name + roster, ambiguous
  // name + candidates, exchange cap). Surface them rather than a bare status.
  if (err.availableAgents?.length) {
    console.error(chalk.dim(`  Agents you can reach: ${err.availableAgents.join(', ')}`));
  }
  if (err.didYouMean?.length) {
    console.error(chalk.dim(`  "${to}" is ambiguous — did you mean: ${err.didYouMean.join(', ')}?`));
  }
  process.exit(1);
}

export async function ask(to, message, opts = {}) {
  const from = resolveFrom(opts);
  try {
    console.error(chalk.dim(`  Asking ${to}… (this blocks until they answer — that is expected)`));
    const res = await apiCall('POST', '/api/innerchat/ask', { from, to, message });
    // The reply goes to stdout alone so it can be piped/read cleanly; the
    // status chatter goes to stderr.
    console.log(res.reply);
    if (res.exchangesRemaining !== undefined) {
      console.error(chalk.dim(`  (${res.exchangesRemaining} exchanges left in this conversation)`));
    }
  } catch (err) {
    reportError(err, to);
  }
}

export async function tell(to, message, opts = {}) {
  const from = resolveFrom(opts);
  try {
    const res = await apiCall('POST', '/api/innerchat/tell', { from, to, message });
    console.error(chalk.green('  Delivered.'), chalk.dim(res.note || `${to} will reply later if needed.`));
  } catch (err) {
    reportError(err, to);
  }
}

// Who can I talk to? The question an agent asks first when it has lost the
// roster from context — and the reason it otherwise starts guessing names.
export async function who() {
  try {
    const me = process.env.GROOVE_AGENT_NAME;
    const data = await apiCall('GET', '/api/agents');
    const agents = Array.isArray(data) ? data : (data.agents || []);
    const others = agents.filter((a) => a.name !== me);

    if (!others.length) {
      console.log(chalk.dim('  No other agents are running right now.'));
    } else {
      console.log(chalk.bold('  Agents you can message:'));
      for (const a of others) {
        const status = a.status === 'running' ? chalk.green('●') : chalk.dim('○');
        console.log(`    ${status} ${chalk.bold(a.name)} ${chalk.dim(`(${a.role}${a.status !== 'running' ? `, ${a.status}` : ''})`)}`);
      }
    }

    const peers = await apiCall('GET', '/api/innerchat/peers').catch(() => ({ peers: [] }));
    if (peers.peers?.length) {
      console.log(chalk.bold('\n  Peer machines (address as name@peer):'));
      for (const p of peers.peers) console.log(`    ${chalk.bold('@' + p.alias)} ${chalk.dim(p.url)}`);
    }

    console.log(chalk.dim('\n  groove ask <name> "<question>"   — blocks until they answer'));
    console.log(chalk.dim('  groove tell <name> "<message>"   — returns immediately'));
  } catch (err) {
    console.error(chalk.red('  Failed:'), err.message);
    process.exit(1);
  }
}
