import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trackedIgnoredFiles } from './check-local-files.mjs';
import { repositoryFiles } from './repository-files.mjs';
import { checkLinks } from './check-links.mjs';
import { existingChangedFiles } from './check-changed.mjs';
import { consumerImports } from './sdk-api-model.mjs';

test('ignored personal content stays outside shared checks and force-addition is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'wg-local-files-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    git('init', '-q');
    writeFileSync(join(root, '.gitignore'), 'personal/\nPRIVATE.md\n');
    mkdirSync(join(root, 'personal'));
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'personal/session.test.mjs'), 'throw Error("private");');
    writeFileSync(join(root, 'docs/PRIVATE.md'), '[private](missing.md)');
    writeFileSync(join(root, 'docs/guide.md'), '[broken](missing.md)');
    git('add', '.');
    assert.deepEqual(trackedIgnoredFiles(root), []);
    assert.deepEqual(repositoryFiles(root).sort(), ['.gitignore', 'docs/guide.md']);
    assert.equal(checkLinks(root).errors.length, 1);
    git('add', '--force', 'docs/PRIVATE.md');
    assert.deepEqual(trackedIgnoredFiles(root), ['docs/PRIVATE.md']);
    git('rm', '--cached', 'docs/PRIVATE.md');
    const changed = new Set(['docs/PRIVATE.md', 'docs/guide.md']);
    assert.deepEqual(existingChangedFiles(changed, root), ['docs/guide.md']);
    writeFileSync(join(root, 'personal/helper.mjs'), "import { hidden } from '@web-geometry/sdk';");
    writeFileSync(join(root, 'consumer.mjs'), "import { visible } from '@web-geometry/sdk';");
    assert.deepEqual([...consumerImports(root)], [['visible', new Set(['consumer.mjs'])]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
