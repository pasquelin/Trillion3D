// Common formulas batch: plancherDuModele, factorized from 2 copies (camera lands there, lights
// attach there).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PATH_POSES, STREET_HALF_WIDTH, plancherDuModele, poseAt } from './poses.ts';

test('plancherDuModele falls back to zero plane when geometry spans the floor', () => {
  assert.equal(plancherDuModele({ min: { y: -2 }, max: { y: 5 } }), 0);
});

test('plancherDuModele takes box bottom when everything is above or below floor', () => {
  assert.equal(plancherDuModele({ min: { y: 2 }, max: { y: 8 } }), 2);
  assert.equal(plancherDuModele({ min: { y: -8 }, max: { y: -2 } }), -8);
});

test('plancherDuModele with exact bounds (min or max at zero) does not cross the plane', () => {
  // min.y === 0 is not "< 0": the box does not span it, floor remains min.y.
  assert.equal(plancherDuModele({ min: { y: 0 }, max: { y: 5 } }), 0);
  // max.y === 0 is not "> 0": same rule on opposite edge.
  assert.equal(plancherDuModele({ min: { y: -5 }, max: { y: 0 } }), -5);
});

// Boxes of three kinds: a courtyard, a tower taller than 66 m (eye clamped to 2 m), a flat slab
// (eye set by its footprint).
const BOXES = [
  { min: { x: -15, y: -1, z: -9 }, max: { x: 15, y: 11, z: 9 } },
  { min: { x: -20, y: 0, z: -20 }, max: { x: 20, y: 120, z: 20 } },
  { min: { x: -400, y: 0, z: -300 }, max: { x: 400, y: 4, z: 300 } },
];

test('every pose of the path is in the street band or outside the box', () => {
  for (const { min, max } of BOXES)
    for (let index = 0; index < PATH_POSES; index++) {
      const { position } = poseAt({ min, max }, index);
      const x = Math.abs(position[0] - (min.x + max.x) / 2) / (max.x - min.x),
        z = Math.abs(position[2] - (min.z + max.z) / 2) / (max.z - min.z);
      const inside = x < 0.5 && z < 0.5 && position[1] < max.y;
      // 1e-9: a share interpolated onto the band's edge lands a rounding above it.
      if (inside)
        assert.ok(Math.max(x, z) <= STREET_HALF_WIDTH + 1e-9, `pose ${index}: ${x}, ${z}`);
    }
});

test('an index past the path wraps round the loop', () => {
  for (const offset of [0, 1, 59, 359, 599])
    assert.deepEqual(poseAt(BOXES[0], PATH_POSES + offset), poseAt(BOXES[0], offset));
});
