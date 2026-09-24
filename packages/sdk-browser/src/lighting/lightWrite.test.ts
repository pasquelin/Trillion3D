import assert from 'node:assert/strict';
import test from 'node:test';
import type { SceneLight } from '../../../sdk-core/src/index.ts';
import { createLight, writeLight } from './lightWrite.ts';

// Issue #275: a spotlight closed to a zero cone has a penumbra, never NaN — the limit of the
// softened edge as the cone closes — so the program draws the reference's closed cone, not NaN.
test('a spotlight of zero cone writes a finite penumbra', () => {
  const source = {
    kind: 'spot',
    color: [1, 1, 1],
    intensity: 1,
    position: [0, 0, 0],
    direction: [0, 0, -1],
    range: 10,
    coneAngle: 0,
  } as unknown as SceneLight;
  const spot = createLight(source) as { angle?: number; penumbra?: number };
  writeLight(spot as never, source);
  assert.equal(spot.angle, 0);
  assert.equal(spot.penumbra, 1);
});
