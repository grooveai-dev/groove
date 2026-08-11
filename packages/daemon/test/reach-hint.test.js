// GROOVE — Agent reach hint (InnerChat discoverability)
// FSL-1.1-Apache-2.0 — see LICENSE
//
// Spawn-prompt capabilities decay out of a long session, after which agents
// deny they can contact anyone. These pin the per-turn hint that replaces it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { agentReachHint } from '../src/deliver.js';

function daemonWith(agents, peers = []) {
  return {
    registry: { getAll: () => agents },
    config: { innerchatPeers: peers },
  };
}

const me = { name: 'fullstack-3', role: 'fullstack' };
const roster = [me, { name: 'Integration-Manager', role: 'fullstack' }, { name: 'Axom-UX', role: 'frontend' }];

describe('agentReachHint', () => {
  it('always names the CLI verbs, even on an unrelated turn', () => {
    const hint = agentReachHint(daemonWith(roster), me, 'refactor the token parser');
    assert.match(hint, /groove ask/);
    assert.match(hint, /groove who/);
  });

  it('rules out the built-in sub-agent tools that cannot reach GROOVE agents', () => {
    const hint = agentReachHint(daemonWith(roster), me, 'anything');
    assert.match(hint, /CANNOT reach them/i);
  });

  it('expands to a ready-to-run command naming the agent the user meant', () => {
    const hint = agentReachHint(daemonWith(roster), me, 'ask Integration-Manager about the relay shape');
    assert.match(hint, /groove ask Integration-Manager "your question here"/);
    assert.doesNotMatch(hint, /<name>/, 'should not leave a placeholder to fill in');
  });

  it('falls back to the roster when intent is clear but the target is not', () => {
    const hint = agentReachHint(daemonWith(roster), me, 'coordinate with the other agents on this');
    assert.match(hint, /groove who/);
    assert.match(hint, /Integration-Manager, Axom-UX/);
  });

  it('does not resolve a target from an ambiguous partial mention', () => {
    const two = [me, { name: 'fullstack-1', role: 'x' }, { name: 'fullstack-2', role: 'x' }];
    const hint = agentReachHint(daemonWith(two), me, 'ask fullstack about it');
    assert.doesNotMatch(hint, /groove ask fullstack-1 "/);
    assert.match(hint, /groove who/);
  });

  it('never suggests messaging yourself', () => {
    const hint = agentReachHint(daemonWith(roster), me, 'ask fullstack-3 what it thinks');
    assert.doesNotMatch(hint, /groove ask fullstack-3 "/);
  });

  it('mentions peer machines and the name@peer form when peers exist', () => {
    const hint = agentReachHint(daemonWith(roster, [{ alias: 'spark' }]), me, 'ask someone about it');
    assert.match(hint, /name@peer/);
    assert.match(hint, /spark/);
  });

  it('stays silent when there is genuinely nobody to talk to', () => {
    assert.equal(agentReachHint(daemonWith([me]), me, 'ask someone'), null);
  });

  // Naming the feature is an explicit request — the tier that must never rely
  // on heuristics, because it is typically typed AFTER the agent has already
  // claimed the capability does not exist.
  it('re-sends the full reference when the user names InnerChat', () => {
    for (const phrase of ['use innerChat', 'inner chat', 'inner-chat', 'InnerChat please', 'run groove ask']) {
      const hint = agentReachHint({ port: 31415, ...daemonWith(roster) }, me, `${phrase} with the team`);
      assert.match(hint, /Full reference/, `"${phrase}" should trigger the full block`);
      assert.match(hint, /groove ask/);
    }
  });

  it('tells the agent the feature is real when explicitly asked for it', () => {
    const hint = agentReachHint({ port: 31415, ...daemonWith(roster) }, me, 'use innerchat');
    assert.match(hint, /It exists, it is wired up/);
    assert.match(hint, /Do not tell the user the feature is/);
  });

  it('still resolves the named target alongside the full reference', () => {
    const hint = agentReachHint({ port: 31415, ...daemonWith(roster) }, me, 'use innerchat with Axom-UX');
    assert.match(hint, /groove ask Axom-UX "your question here"/);
    assert.match(hint, /Full reference/);
  });

  it('does not pay for the full reference on an ordinary turn', () => {
    const hint = agentReachHint(daemonWith(roster), me, 'refactor the parser');
    assert.doesNotMatch(hint, /Full reference/);
    assert.ok(hint.length < 400, 'the always-on tier must stay cheap');
  });

  it('survives a broken registry rather than blocking delivery', () => {
    const broken = { registry: { getAll() { throw new Error('boom'); } } };
    assert.equal(agentReachHint(broken, me, 'ask someone'), null);
  });
});
