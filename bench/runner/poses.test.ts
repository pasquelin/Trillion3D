// Common formulas batch: plancherDuModele, factorized from 2 copies (camera lands there, lights
// attach there).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAMES_PER_SEGMENT, STREET_HALF_WIDTH, VIEWS, plancherDuModele, poseAt } from './poses.ts';

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

test('every pose a view captures, held or moving, is outside the box or in its middle', () => {
  const { min, max } = { min: { x: -15, y: -1, z: -9 }, max: { x: 15, y: 11, z: 9 } };
  // The held capture is the view's pose; the moving one ends the run, one segment by default.
  for (const { index } of Object.values(VIEWS))
    for (const capture of [index, index + FRAMES_PER_SEGMENT - 1]) {
      const { position } = poseAt({ min, max }, capture);
      const x = Math.abs(position[0] - (min.x + max.x) / 2) / (max.x - min.x),
        z = Math.abs(position[2] - (min.z + max.z) / 2) / (max.z - min.z);
      const inside = x < 0.5 && z < 0.5 && position[1] < max.y;
      // 1e-9: a share interpolated onto the band's edge lands a rounding above it.
      if (inside)
        assert.ok(Math.max(x, z) <= STREET_HALF_WIDTH + 1e-9, `pose ${capture}: ${x}, ${z}`);
    }
});
