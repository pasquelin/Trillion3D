import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitPaths } from './git-paths.mjs';

test('reads every Git path beyond 1 MiB, preserving Unicode and embedded newlines', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'geometry-git-paths-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd });
    const directory = 'assets-'.padEnd(180, 'x');
    mkdirSync(join(cwd, directory));
    const expected = [];
    for (let index = 0; index < 5000; index++) {
      const path = `${directory}/${String(index).padStart(4, '0')}-é\n${'y'.repeat(40)}.bin`;
      expected.push(path);
      writeFileSync(join(cwd, path), '');
    }
    assert.ok(Buffer.byteLength(expected.join('\0')) > 1024 * 1024);
    const actual = await gitPaths(['ls-files', '--others', '--exclude-standard', '-z'], cwd);
    assert.deepEqual(actual.sort(), expected.sort());
    await assert.rejects(gitPaths(['not-a-git-command'], cwd), /git exited/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
