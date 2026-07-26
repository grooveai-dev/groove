// GROOVE — Axom Remote Control Tests
// FSL-1.1-Apache-2.0 — see LICENSE
//
// SSH is injected, so these assert the COMMANDS we would run and the honesty
// of what we report — never that ssh itself works.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AxomRemote, validateRemote } from '../src/axom-remote.js';

function harness({ responses = {}, remote = { host: 'spark.local', user: 'axom' } } = {}) {
  const calls = [];
  const daemon = {
    config: { axom: { remote } },
    broadcast() {},
    audit: { log() {} },
  };
  const exec = (bin, args, opts, cb) => {
    const command = args[args.length - 1];
    calls.push({ bin, target: args[args.length - 2], command });
    const match = Object.keys(responses).find((k) => command.includes(k));
    const out = match ? responses[match] : '';
    if (out instanceof Error) return cb(out, '', out.message);
    cb(null, out, '');
  };
  return { remote: new AxomRemote(daemon, { exec }), calls, daemon };
}

describe('AxomRemote', () => {
  it('reports running/not-running from a probe on the remote host', async () => {
    const up = harness({ responses: { '/about': 'UP\n' } });
    assert.deepEqual(await up.remote.status(), {
      configured: true, host: 'spark.local', user: 'axom', port: 8737, running: true, error: null,
    });
    const down = harness({ responses: { '/about': 'DOWN\n' } });
    assert.equal((await down.remote.status()).running, false);
  });

  it('reports UNKNOWN (not "stopped") when the host is unreachable', async () => {
    const h = harness({ responses: { '/about': new Error('ssh: connect to host spark.local port 22: No route to host') } });
    const s = await h.remote.status();
    // A host we cannot reach tells us nothing about the runtime. Saying
    // "stopped" would be a guess presented as fact.
    assert.equal(s.running, null);
    assert.match(s.error, /No route to host/);
  });

  it('starts detached with no supervisor and confirms it actually came up', async () => {
    let probes = 0;
    const h = harness({
      responses: {
        get '/about'() { probes += 1; return probes === 1 ? 'DOWN\n' : 'UP\n'; },
        'nohup': 'STARTED\n',
      },
    });
    const result = await h.remote.start();
    assert.equal(result.started, true);
    const startCmd = h.calls.find((c) => c.command.includes('nohup')).command;
    assert.match(startCmd, /axom serve --port 8737/);
    assert.match(startCmd, /disown/);           // survives the ssh session
    assert.equal(/while|until|restart|systemctl/.test(startCmd), false); // never supervised
  });

  it('does not start a second runtime when one is already up', async () => {
    const h = harness({ responses: { '/about': 'UP\n' } });
    assert.deepEqual(await h.remote.start(), { started: false, alreadyRunning: true, port: 8737 });
    assert.equal(h.calls.some((c) => c.command.includes('nohup')), false);
  });

  it('stops via the §14 shutdown verb when the runtime supports it', async () => {
    const h = harness({ responses: { '/shutdown': '202', '/about': 'DOWN\n' } });
    const result = await h.remote.stop();
    assert.deepEqual(result, { stopped: true, via: 'shutdown' });
    assert.equal(h.calls.some((c) => c.command.includes('kill')), false); // no signal needed
  });

  it('refuses to stop mid-turn unless forced, and passes force through', async () => {
    const busy = harness({ responses: { '/shutdown': '409', '/about': 'UP\n' } });
    assert.deepEqual(await busy.remote.stop(), { stopped: false, turnInFlight: true });

    const forced = harness({ responses: { '/shutdown': '202', '/about': 'UP\n' } });
    await forced.remote.stop({ force: true });
    assert.match(forced.calls.find((c) => c.command.includes('/shutdown')).command, /"force":true/);
  });

  it('falls back to a signal only for runtimes predating §14', async () => {
    const h = harness({ responses: { '/shutdown': '404', '/about': 'UP\n' } });
    const result = await h.remote.stop();
    assert.deepEqual(result, { stopped: true, via: 'signal' });
    assert.match(h.calls.find((c) => c.command.includes('kill')).command, /lsof -t -i:8737/);
  });

  it('reports unconfigured rather than pretending', async () => {
    const h = harness({ remote: null });
    assert.deepEqual(await h.remote.status(), { configured: false, running: null });
    await assert.rejects(() => h.remote.start(), /no remote Axom host configured/);
  });
});

describe('validateRemote', () => {
  it('accepts a clean config', () => {
    assert.equal(validateRemote({ host: 'spark.local', user: 'axom', sshPort: 22, port: 8737 }), null);
  });

  it('rejects shell metacharacters and malformed values', () => {
    // host/user reach execFile as single argv entries, but a permissive
    // validator would still invite injection attempts through config.
    assert.ok(validateRemote({ host: 'spark.local; rm -rf /', user: 'axom' }));
    assert.ok(validateRemote({ host: 'spark.local', user: 'axom$(id)' }));
    assert.ok(validateRemote({ host: 'a'.repeat(300), user: 'axom' }));
    assert.ok(validateRemote({ host: 'spark.local', user: 'axom', sshPort: 99999 }));
    assert.ok(validateRemote({ host: 'spark.local', user: 'axom', command: 'x'.repeat(600) }));
    assert.ok(validateRemote(null));
  });
});
