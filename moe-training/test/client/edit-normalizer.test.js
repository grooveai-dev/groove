// FSL-1.1-Apache-2.0 — see LICENSE

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EditNormalizer, estimateTokens } from '../../client/edit-normalizer.js';

describe('EditNormalizer', () => {
  let normalizer;

  beforeEach(() => {
    normalizer = new EditNormalizer();
  });

  describe('detectApplyPatch', () => {
    it('detects apply_patch in a raw string', () => {
      assert.equal(normalizer.detectApplyPatch('apply_patch <<\'PATCH\'\n*** Begin Patch'), true);
    });

    it('detects apply_patch in action step arguments', () => {
      const step = {
        arguments: { command: 'apply_patch <<\'PATCH\'\n*** Begin Patch\n*** End Patch\nPATCH' },
      };
      assert.equal(normalizer.detectApplyPatch(step), true);
    });

    it('detects apply_patch in action step content', () => {
      const step = { content: 'Running apply_patch to modify files' };
      assert.equal(normalizer.detectApplyPatch(step), true);
    });

    it('returns false for non-patch content', () => {
      assert.equal(normalizer.detectApplyPatch('ls -la'), false);
      assert.equal(normalizer.detectApplyPatch({ content: 'echo hello' }), false);
    });

    it('returns false for null/undefined', () => {
      assert.equal(normalizer.detectApplyPatch(null), false);
      assert.equal(normalizer.detectApplyPatch(undefined), false);
      assert.equal(normalizer.detectApplyPatch(''), false);
    });
  });

  describe('normalize — Add File', () => {
    it('parses a single Add File section', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Add File: index.html',
        '<!doctype html>',
        '<html><body>Hello</body></html>',
        '*** End Patch',
        'PATCH',
      ].join('\n');

      const edits = normalizer.normalize(patch, 1000, 5);
      assert.equal(edits.length, 1);
      assert.equal(edits[0].type, 'edit');
      assert.equal(edits[0].edit_type, 'create');
      assert.equal(edits[0].file_path, 'index.html');
      assert.ok(edits[0].content.includes('<!doctype html>'));
      assert.ok(edits[0].content.includes('<html><body>Hello</body></html>'));
      assert.equal(edits[0].step, 5);
      assert.equal(edits[0].timestamp, 1000);
      assert.ok(edits[0].token_count > 0);
    });

    it('parses multiple Add File sections', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Add File: index.html',
        '<html></html>',
        '*** Add File: styles.css',
        'body { margin: 0; }',
        '*** Add File: app.js',
        'console.log("hello");',
        '*** End Patch',
        'PATCH',
      ].join('\n');

      const edits = normalizer.normalize(patch, 1000, 1);
      assert.equal(edits.length, 3);
      assert.equal(edits[0].file_path, 'index.html');
      assert.equal(edits[0].edit_type, 'create');
      assert.equal(edits[1].file_path, 'styles.css');
      assert.equal(edits[1].edit_type, 'create');
      assert.equal(edits[2].file_path, 'app.js');
      assert.equal(edits[2].edit_type, 'create');
    });

    it('increments step numbers for multiple edits', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Add File: a.js',
        'file a',
        '*** Add File: b.js',
        'file b',
        '*** End Patch',
        'PATCH',
      ].join('\n');

      const edits = normalizer.normalize(patch, 1000, 10);
      assert.equal(edits[0].step, 10);
      assert.equal(edits[1].step, 11);
    });
  });

  describe('normalize — Update File', () => {
    it('parses a simple Update File with a hunk', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Update File: app.js',
        '@@@ context @@@',
        ' const x = 1;',
        '-const y = 2;',
        '+const y = 3;',
        ' const z = 4;',
        '*** End Patch',
        'PATCH',
      ].join('\n');

      const edits = normalizer.normalize(patch, 1000, 1);
      assert.equal(edits.length, 1);
      assert.equal(edits[0].type, 'edit');
      assert.equal(edits[0].edit_type, 'modify');
      assert.equal(edits[0].file_path, 'app.js');
      assert.ok(edits[0].old_string.includes('const y = 2;'));
      assert.ok(edits[0].new_string.includes('const y = 3;'));
      assert.ok(edits[0].old_string.includes('const x = 1;'));
      assert.ok(edits[0].new_string.includes('const x = 1;'));
      assert.equal(edits[0].content, null);
    });

    it('parses multiple hunks as separate edit steps', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Update File: app.js',
        '@@@ hunk 1 @@@',
        '-old line 1',
        '+new line 1',
        '@@@ hunk 2 @@@',
        '-old line 2',
        '+new line 2',
        '*** End Patch',
        'PATCH',
      ].join('\n');

      const edits = normalizer.normalize(patch, 1000, 1);
      assert.equal(edits.length, 2);
      assert.equal(edits[0].old_string, 'old line 1');
      assert.equal(edits[0].new_string, 'new line 1');
      assert.equal(edits[1].old_string, 'old line 2');
      assert.equal(edits[1].new_string, 'new line 2');
    });

    it('handles complex hunks with multiple old/new lines', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Update File: config.json',
        '@@@ context @@@',
        ' {',
        '-  "port": 3000,',
        '-  "host": "localhost"',
        '+  "port": 8080,',
        '+  "host": "0.0.0.0",',
        '+  "debug": true',
        ' }',
        '*** End Patch',
        'PATCH',
      ].join('\n');

      const edits = normalizer.normalize(patch, 1000, 1);
      assert.equal(edits.length, 1);
      assert.ok(edits[0].old_string.includes('"port": 3000,'));
      assert.ok(edits[0].old_string.includes('"host": "localhost"'));
      assert.ok(edits[0].new_string.includes('"port": 8080,'));
      assert.ok(edits[0].new_string.includes('"host": "0.0.0.0",'));
      assert.ok(edits[0].new_string.includes('"debug": true'));
    });

    it('handles hunks without explicit @@@ headers', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Update File: app.js',
        '-const old = true;',
        '+const old = false;',
        '*** End Patch',
        'PATCH',
      ].join('\n');

      const edits = normalizer.normalize(patch, 1000, 1);
      assert.equal(edits.length, 1);
      assert.equal(edits[0].old_string, 'const old = true;');
      assert.equal(edits[0].new_string, 'const old = false;');
    });
  });

  describe('normalize — Delete File', () => {
    it('parses a Delete File section', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Delete File: obsolete.json',
        '*** End Patch',
        'PATCH',
      ].join('\n');

      const edits = normalizer.normalize(patch, 1000, 1);
      assert.equal(edits.length, 1);
      assert.equal(edits[0].type, 'edit');
      assert.equal(edits[0].edit_type, 'delete');
      assert.equal(edits[0].file_path, 'obsolete.json');
      assert.equal(edits[0].new_string, null);
    });

    it('captures old content for Delete File when present', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Delete File: old-config.json',
        '{"key": "value"}',
        '*** End Patch',
        'PATCH',
      ].join('\n');

      const edits = normalizer.normalize(patch, 1000, 1);
      assert.equal(edits.length, 1);
      assert.equal(edits[0].edit_type, 'delete');
      assert.equal(edits[0].old_string, '{"key": "value"}');
      assert.equal(edits[0].new_string, null);
    });
  });

  describe('normalize — Mixed operations', () => {
    it('parses a patch with Add, Update, and Delete in one block', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Add File: new-file.js',
        'console.log("new");',
        '*** Update File: existing.js',
        '@@@ context @@@',
        '-const v = 1;',
        '+const v = 2;',
        '*** Delete File: old-file.js',
        '*** End Patch',
        'PATCH',
      ].join('\n');

      const edits = normalizer.normalize(patch, 1000, 1);
      assert.equal(edits.length, 3);
      assert.equal(edits[0].edit_type, 'create');
      assert.equal(edits[0].file_path, 'new-file.js');
      assert.equal(edits[1].edit_type, 'modify');
      assert.equal(edits[1].file_path, 'existing.js');
      assert.equal(edits[2].edit_type, 'delete');
      assert.equal(edits[2].file_path, 'old-file.js');
    });

    it('handles action step object input', () => {
      const step = {
        arguments: {
          command: [
            'apply_patch <<\'PATCH\'',
            '*** Begin Patch',
            '*** Add File: test.txt',
            'hello world',
            '*** End Patch',
            'PATCH',
          ].join('\n'),
        },
      };

      const edits = normalizer.normalize(step, 1000, 1);
      assert.equal(edits.length, 1);
      assert.equal(edits[0].edit_type, 'create');
      assert.equal(edits[0].file_path, 'test.txt');
    });
  });

  describe('normalize — Edge cases', () => {
    it('returns empty array for non-patch content', () => {
      assert.deepEqual(normalizer.normalize('ls -la', 1000, 1), []);
    });

    it('returns empty array for null input', () => {
      assert.deepEqual(normalizer.normalize(null, 1000, 1), []);
    });

    it('returns empty array for malformed patch (no Begin Patch)', () => {
      const text = '*** Add File: test.txt\nhello\n*** End Patch';
      assert.deepEqual(normalizer.normalize(text, 1000, 1), []);
    });

    it('handles patch with no End Patch marker', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Add File: file.js',
        'content here',
      ].join('\n');

      const edits = normalizer.normalize(patch, 1000, 1);
      assert.equal(edits.length, 1);
      assert.equal(edits[0].file_path, 'file.js');
    });

    it('uses current timestamp when not provided', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Add File: a.js',
        'x',
        '*** End Patch',
        'PATCH',
      ].join('\n');

      const before = Date.now() / 1000;
      const edits = normalizer.normalize(patch, undefined, 1);
      const after = Date.now() / 1000;
      assert.ok(edits[0].timestamp >= before);
      assert.ok(edits[0].timestamp <= after + 1);
    });

    it('defaults startStep to 1', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Add File: a.js',
        'x',
        '*** End Patch',
        'PATCH',
      ].join('\n');

      const edits = normalizer.normalize(patch, 1000);
      assert.equal(edits[0].step, 1);
    });

    it('handles file paths with directories', () => {
      const patch = [
        'apply_patch <<\'PATCH\'',
        '*** Begin Patch',
        '*** Add File: src/components/Header.jsx',
        '<div>Header</div>',
        '*** End Patch',
        'PATCH',
      ].join('\n');

      const edits = normalizer.normalize(patch, 1000, 1);
      assert.equal(edits[0].file_path, 'src/components/Header.jsx');
    });
  });
});

describe('estimateTokens', () => {
  it('estimates at ~4 chars per token', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcdefgh'), 2);
    assert.equal(estimateTokens('a'.repeat(100)), 25);
  });

  it('returns at least 1 for non-empty input', () => {
    assert.equal(estimateTokens('a'), 1);
  });

  it('returns 0 for empty/null input', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens(undefined), 0);
  });
});
