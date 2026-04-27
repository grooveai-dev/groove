// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DomainTagger, cosineSimilarity } from '../../client/domain-tagger.js';

describe('DomainTagger', () => {
  let tagger;

  beforeEach(async () => {
    tagger = new DomainTagger();
    await tagger.init();
  });

  it('initializes in keyword mode when no embedding service is configured', async () => {
    assert.equal(tagger.ready, true);
    assert.equal(tagger.mode, 'keyword');
  });

  it('tags Python-related routing text', async () => {
    const text = DomainTagger.buildRoutingText(
      'Fix Python unit tests',
      'The pytest suite is failing on the Django model validators',
      [{ content: 'I need to check the pytest output and fix the failing tests' }]
    );
    const result = await tagger.tag(text);
    assert.notEqual(result, null);
    assert.equal(result.primary.domain, 'python');
    assert.ok(result.primary.confidence > 0);
  });

  it('tags React/frontend routing text', async () => {
    const text = DomainTagger.buildRoutingText(
      'Build a React component with Tailwind CSS',
      'Create a new JSX component using hooks and styled with Tailwind',
      [{ content: 'I will use useState and useEffect hooks for this component' }]
    );
    const result = await tagger.tag(text);
    assert.notEqual(result, null);
    assert.equal(result.primary.domain, 'react_frontend');
    assert.ok(result.primary.confidence > 0);
  });

  it('tags Rust routing text', async () => {
    const text = DomainTagger.buildRoutingText(
      'Fix Rust ownership error',
      'The cargo build fails with a borrow checker lifetime error in main.rs',
      [{ content: 'I need to check the struct impl and fix the lifetime annotation' }]
    );
    const result = await tagger.tag(text);
    assert.notEqual(result, null);
    assert.equal(result.primary.domain, 'rust');
  });

  it('tags DevOps/Docker routing text', async () => {
    const text = DomainTagger.buildRoutingText(
      'Fix Dockerfile build',
      'The Docker compose deployment fails on Kubernetes with nginx config errors',
      [{ content: 'Let me check the Dockerfile and the helm chart' }]
    );
    const result = await tagger.tag(text);
    assert.notEqual(result, null);
    assert.equal(result.primary.domain, 'devops_docker');
  });

  it('tags database-related routing text', async () => {
    const text = DomainTagger.buildRoutingText(
      'Optimize SQL query',
      'The PostgreSQL SELECT query with JOIN is slow, need to add an index',
      [{ content: 'I will check the query plan and add the missing index' }]
    );
    const result = await tagger.tag(text);
    assert.notEqual(result, null);
    assert.equal(result.primary.domain, 'postgresql_database');
  });

  it('tags ML/data science routing text', async () => {
    const text = DomainTagger.buildRoutingText(
      'Train neural network model',
      'Fine-tune the PyTorch transformer model on the new dataset with huggingface',
      [{ content: 'I will set up the training loop with epoch tracking and loss metrics' }]
    );
    const result = await tagger.tag(text);
    assert.notEqual(result, null);
    assert.equal(result.primary.domain, 'data_science_ml');
  });

  it('returns all three tag levels with correct structure', async () => {
    const text = 'Build a React component with TypeScript and Tailwind CSS for the frontend';
    const result = await tagger.tag(text);
    assert.notEqual(result, null);
    assert.ok(result.primary);
    assert.ok(result.secondary);
    assert.ok(result.tertiary);
    assert.equal(typeof result.primary.domain, 'string');
    assert.equal(typeof result.primary.confidence, 'number');
    assert.equal(typeof result.secondary.domain, 'string');
    assert.equal(typeof result.secondary.confidence, 'number');
    assert.equal(typeof result.tertiary.domain, 'string');
    assert.equal(typeof result.tertiary.confidence, 'number');
  });

  it('primary confidence >= secondary >= tertiary', async () => {
    const text = 'Build a React JSX component with hooks and CSS styling for the frontend DOM';
    const result = await tagger.tag(text);
    assert.notEqual(result, null);
    assert.ok(result.primary.confidence >= result.secondary.confidence);
    assert.ok(result.secondary.confidence >= result.tertiary.confidence);
  });

  it('returns null for empty or missing input', async () => {
    assert.equal(await tagger.tag(''), null);
    assert.equal(await tagger.tag(null), null);
    assert.equal(await tagger.tag(undefined), null);
  });

  it('returns null for unrecognizable content', async () => {
    const result = await tagger.tag('asdfghjkl 12345 zzzzz');
    assert.equal(result, null);
  });

  it('returns null when not initialized', async () => {
    const uninit = new DomainTagger();
    const result = await uninit.tag('Build a Python Django app');
    assert.equal(result, null);
  });

  it('gracefully degrades when embedding service is unreachable', async () => {
    const taggerHttp = new DomainTagger({ serviceUrl: 'http://localhost:99999/v1/embeddings' });
    await taggerHttp.init();
    assert.equal(taggerHttp.ready, true);
    assert.equal(taggerHttp.mode, 'keyword');
    const result = await taggerHttp.tag('Build a Python Flask API');
    assert.notEqual(result, null);
    assert.equal(result.primary.domain, 'python');
  });

  it('does not block on tag failure — returns null', async () => {
    const start = Date.now();
    const brokenTagger = new DomainTagger({ serviceUrl: 'http://localhost:99999/v1/embeddings' });
    await brokenTagger.init();
    const result = await brokenTagger.tag('anything');
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 10_000, `tag() took ${elapsed}ms, should not block`);
    assert.ok(result !== undefined);
  });
});

describe('DomainTagger.buildRoutingText', () => {
  it('combines task title, prompt, and thought steps', () => {
    const text = DomainTagger.buildRoutingText(
      'Fix bug',
      'The server crashes on startup',
      [{ content: 'Let me check the logs' }, { content: 'I see the error' }]
    );
    assert.ok(text.includes('Fix bug'));
    assert.ok(text.includes('The server crashes on startup'));
    assert.ok(text.includes('Let me check the logs'));
    assert.ok(text.includes('I see the error'));
  });

  it('limits to first 2 thought steps', () => {
    const text = DomainTagger.buildRoutingText(
      'Task',
      'Prompt',
      [{ content: 'Step 1' }, { content: 'Step 2' }, { content: 'Step 3' }]
    );
    assert.ok(text.includes('Step 1'));
    assert.ok(text.includes('Step 2'));
    assert.ok(!text.includes('Step 3'));
  });

  it('handles missing parts gracefully', () => {
    assert.equal(DomainTagger.buildRoutingText(null, null, []), '');
    assert.ok(DomainTagger.buildRoutingText('Title', null, []).includes('Title'));
    assert.ok(DomainTagger.buildRoutingText(null, 'Prompt', []).includes('Prompt'));
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 0.0001);
  });

  it('returns 0 for orthogonal vectors', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 0.0001);
  });

  it('returns -1 for opposite vectors', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) - (-1)) < 0.0001);
  });

  it('returns 0 for mismatched lengths', () => {
    assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  });

  it('returns 0 for null/empty inputs', () => {
    assert.equal(cosineSimilarity(null, [1, 2]), 0);
    assert.equal(cosineSimilarity([1, 2], null), 0);
    assert.equal(cosineSimilarity([], []), 0);
  });
});
