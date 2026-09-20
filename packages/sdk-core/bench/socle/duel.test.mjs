// The duel's `slower` gate, run in a child whose clock is replaced: ticking one millisecond per
// reading, both sides measure the same and the ceiling holds; frozen, no side has a median and the
// ceiling must fail instead of reading `1 + null`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLOCKS = {
  ticking: () => {
    let now = 0n;
    return () => (now += 1_000_000n);
  },
  frozen: () => () => 0n,
};

if (process.env.DUEL_CLOCK) {
  process.hrtime.bigint = CLOCKS[process.env.DUEL_CLOCK]();
  const { duel } = await import('../oracles/three-duel.mjs');
  const out = new Float64Array(3);
  await duel({
    name: 'replaced clock',
    fichier: 'packages/sdk-core/bench/oracles/three-duel.mjs',
    size: 1,
    three: () => {},
    oracle: () => out,
    core: () => out,
    slower: { atMost: 1.5, reason: 'a declared ceiling' },
  });
} else {
  // The child reports in plain TAP: it is not a test of the parent's runner.
  const env = { ...process.env, DUEL_CLOCK: '' };
  delete env.NODE_TEST_CONTEXT;
  const run = (clock) =>
    spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url)], {
      env: { ...env, DUEL_CLOCK: clock },
      encoding: 'utf8',
    });

  test('a declared ceiling passes on the median quotient the witness column prints', () => {
    const ticking = run('ticking');
    assert.equal(ticking.status, 0, ticking.stdout + ticking.stderr);
  });

  test('a declared ceiling fails when the witness has no median, instead of reading as 1', () => {
    const frozen = run('frozen');
    assert.notEqual(frozen.status, 0, 'the gate let a witness without a median through');
    assert.match(frozen.stdout, /sdk-core median NaN× Three\.js, above the declared 1\.5×/);
  });
}
