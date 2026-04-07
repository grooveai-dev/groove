// GROOVE CLI — federation commands
// FSL-1.1-Apache-2.0 — see LICENSE

import chalk from 'chalk';
import { apiCall } from '../client.js';

export async function federationPair(target) {
  // target can be: <ip>:<port>, <ip> (default port), tailscale-ip
  let remoteUrl = target;
  if (!remoteUrl.startsWith('http')) {
    // Add default port if not specified
    const hasPort = remoteUrl.includes(':') && !remoteUrl.startsWith('[');
    remoteUrl = `http://${remoteUrl}${hasPort ? '' : ':31415'}`;
  }

  console.log('');
  console.log(chalk.dim(`  Pairing with ${remoteUrl}...`));

  try {
    const result = await apiCall('POST', '/api/federation/initiate', { remoteUrl });
    console.log(chalk.green('  Paired successfully!'));
    console.log('');
    console.log(`  Peer ID:   ${result.peerId}`);
    console.log(`  Peer Name: ${result.peerName}`);
    console.log(`  Peer Host: ${result.peerHost}`);
    console.log('');
  } catch (err) {
    console.log(chalk.red('  Pairing failed: ') + err.message);
    console.log('');
  }
}

export async function federationUnpair(peerId) {
  console.log('');
  try {
    await apiCall('DELETE', `/api/federation/peers/${peerId}`);
    console.log(chalk.green(`  Unpaired peer ${peerId}.`));
  } catch (err) {
    console.log(chalk.red('  Unpair failed: ') + err.message);
  }
  console.log('');
}

export async function federationList() {
  console.log('');
  try {
    const peers = await apiCall('GET', '/api/federation/peers');
    if (peers.length === 0) {
      console.log(chalk.dim('  No paired peers.'));
      console.log(`  Run ${chalk.bold('groove federation pair <host>')} to pair with a remote daemon.`);
    } else {
      console.log(chalk.bold(`  Paired Peers`) + chalk.dim(` (${peers.length})`));
      console.log('');
      for (const peer of peers) {
        const age = peer.pairedAt ? chalk.dim(` (since ${new Date(peer.pairedAt).toLocaleDateString()})`) : '';
        console.log(`  ${chalk.cyan(peer.id)}  ${peer.host}:${peer.port}${age}`);
      }
    }
  } catch {
    console.log(chalk.yellow('  Daemon not running.'));
  }
  console.log('');
}

export async function federationStatus() {
  console.log('');
  try {
    const status = await apiCall('GET', '/api/federation');
    console.log(chalk.bold('  Federation'));
    console.log('');
    console.log(`  Daemon ID:  ${chalk.cyan(status.id)}`);
    console.log(`  Keypair:    ${status.hasKeypair ? chalk.green('ready') : chalk.red('missing')}`);
    console.log(`  Peers:      ${status.peerCount}`);
    if (status.peers.length > 0) {
      console.log('');
      for (const peer of status.peers) {
        console.log(`    ${chalk.cyan(peer.id)}  ${peer.host}:${peer.port}`);
      }
    }
  } catch {
    console.log(chalk.yellow('  Daemon not running.'));
  }
  console.log('');
}
