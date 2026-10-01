import test from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { JOLT_COMMIT } from './joltCommit.ts';

test('JOLT_COMMIT is the pin of the Jolt submodule the compiler cooks with', () => {
  const root = new URL('../../../../', import.meta.url);
  const entry = execFileSync('git', ['ls-files', '-s', 'packages/physics-jolt-wasm/JoltPhysics'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(JOLT_COMMIT, entry.split(/\s+/)[1], 'bump JOLT_COMMIT with the submodule');
});
