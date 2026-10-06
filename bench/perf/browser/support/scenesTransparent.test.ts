import assert from 'node:assert/strict';
import test from 'node:test';
import { FACES, ITEMS, regimes } from './scenesTransparent.ts';
import { callsOf, sceneDe } from './transparentRounds.ts';

for (const [index, [name, side]] of FACES.entries()) {
  test(`transparent benchmark: ${name} keeps the reference ranges with batched draws`, () => {
    const laps = sceneDe(name, side);
    assert.equal(laps.after.blendState.seeds[0].length, ITEMS * (index + 1));
    assert.equal(laps.after.blendState.seeds[1].length, 0);
    // Four unpaged primitives retain their own hardware-culled draws per face.
    assert.deepEqual(callsOf(laps), {
      name,
      before: 3008 * (index + 1),
      after: index ? 13 : 9,
    });

    for (const [regime, frames] of regimes) {
      for (const frame of frames) {
        assert.deepEqual(laps.passAfter([frame]), laps.passBefore([frame]), `${regime}: rejects`);
        // Compare each frame immediately: each lap reuses its output buffer.
        const ranges = laps.passBeforeSeq([frame])[0];
        assert.ok(ranges instanceof Uint32Array);
        const expected = ranges.slice();
        assert.ok(expected.length > 0, `${regime}: nonempty reference`);
        assert.deepEqual(laps.passAfterSeq([frame])[0], expected, `${regime}: paint ranges`);
      }
    }
  });
}
