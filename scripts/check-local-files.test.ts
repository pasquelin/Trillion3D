import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trackedIgnoredFiles } from './check-local-files.ts';
import { repositoryFiles } from './repository-files.ts';
import { checkLinks } from './check-links.ts';
import { existingChangedFiles } from './check-changed.ts';
import { consumerImports } from './sdk-api-model.ts';

test('ignored personal content stays outside shared checks and force-addition is rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'wg-local-files-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    git('init', '-q');
    writeFileSync(join(root, '.gitignore'), 'personal/\nPRIVATE.md\n');
    mkdirSync(join(root, 'personal'));
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'personal/session.test.ts'), 'throw Error("private");');
    writeFileSync(join(root, 'docs/PRIVATE.md'), '[private](missing.md)');
    writeFileSync(join(root, 'docs/guide.md'), '[broken](missing.md)');
    git('add', '.');
    assert.deepEqual(trackedIgnoredFiles(root), []);
    const files = repositoryFiles(root);
    assert.ok(files);
    assert.deepEqual(files.sort(), ['.gitignore', 'docs/guide.md']);
    assert.equal(checkLinks(root).errors.length, 1);
    git('add', '--force', 'docs/PRIVATE.md');
    assert.deepEqual(trackedIgnoredFiles(root), ['docs/PRIVATE.md']);
    git('rm', '--cached', 'docs/PRIVATE.md');
    const changed = new Set(['docs/PRIVATE.md', 'docs/guide.md']);
    assert.deepEqual(existingChangedFiles(changed, root), ['docs/guide.md']);
    writeFileSync(join(root, 'personal/helper.ts'), "import { hidden } from 'trillion3d';");
    writeFileSync(join(root, 'consumer.ts'), "import { visible } from 'trillion3d';");
    assert.deepEqual([...consumerImports(root)], [['visible', new Set(['consumer.ts'])]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
