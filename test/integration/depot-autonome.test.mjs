import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);

// THE REPOSITORY NEVER NAMES THE MACHINE IT WAS WRITTEN ON.
//
// A tracked file that carries a path into someone's home directory (a tool hook written with the
// absolute path of a binary, a marker file dropped by an installer, an exporter that stamps the
// source file's location into a binary asset) ties the repository to one workstation and leaks its
// owner's account name. The repository is self-contained: it builds, tests and
// measures itself with its own dependencies, so nothing in it may point outside the working tree.
// Binary files are scanned too — the Alembic fixture once carried its exporter's path.
const HOME_PATH = /\/(?:Users|home)\/[A-Za-z0-9._-]+\//;

test('no tracked file points into a home directory', async () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const offenders = [];
  for (const file of tracked) {
    const bytes = await readFile(new URL(file, root));
    if (HOME_PATH.test(bytes.toString('latin1'))) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
