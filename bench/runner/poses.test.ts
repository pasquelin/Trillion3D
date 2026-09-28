// Common formulas batch: plancherDuModele, factorized from 2 copies (camera lands there, lights
// attach there).
import test from 'node:test';
import assert from 'node:assert/strict';
import { POINTS, STREET_HALF_WIDTH, plancherDuModele } from './poses.ts';

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

test('every reference-level point of the trajectory keeps to the middle of the model', () => {
  // The listed points only: a descent into reference level (point 1 to 2) passes the target's
  // height just outside the band, a transit no view captures.
  for (const [x, height, z] of POINTS) {
    if (height > 2) continue;
    assert.ok(Math.max(Math.abs(x), Math.abs(z)) <= STREET_HALF_WIDTH, `[${x}, ${height}, ${z}]`);
  }
});
