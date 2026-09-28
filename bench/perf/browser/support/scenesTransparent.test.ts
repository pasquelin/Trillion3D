import assert from 'node:assert/strict';
import test from 'node:test';
import { benchSide, FACES, glisse, ITEMS, pose, regimes } from './scenesTransparent.ts';
import { appelsEncodes, tours } from './transparentRounds.ts';
import {
  argumentsReference,
  classementReference,
  encodeReference,
} from '../../../oracles/browser/transparent-orders.ts';

for (const [index, [name, side]] of FACES.entries()) {
  test(`transparent benchmark: ${name} keeps the reference ranges with batched draws`, () => {
    const before = benchSide(side),
      after = benchSide(side),
      laps = tours(before, after),
      image = glisse[0];
    assert.equal(after.blendState.orders[0].length, ITEMS * (index + 1));
    assert.equal(after.blendState.orders[1].length, 0);
    pose(before, image);
    classementReference(before.scene, before.order, image.eye);
    argumentsReference(before.scene, before.args);
    const reference = encodeReference(before.scene, before.order, before.args, before.output);
    laps.tourApres([image]);
    assert.equal(reference.encoded, index ? 6016 : 3008);
    // Four unpaged primitives retain their own hardware-culled draws per face.
    assert.equal(appelsEncodes(), index ? 13 : 9);

    for (const [regime, frames] of regimes) {
      for (const frame of frames) {
        assert.deepEqual(laps.tourApres([frame]), laps.tourAvant([frame]), `${regime}: rejects`);
        // Compare each frame immediately: each lap reuses its output buffer.
        const ranges = laps.tourAvantSeq([frame])[0];
        assert.ok(ranges instanceof Uint32Array);
        const expected = ranges.slice();
        assert.ok(expected.length > 0, `${regime}: nonempty reference`);
        assert.deepEqual(laps.tourApresSeq([frame])[0], expected, `${regime}: paint ranges`);
      }
    }
  });
}
