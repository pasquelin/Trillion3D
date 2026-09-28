// Common formulas batch: plancherDuModele, factorized from 2 copies (camera lands there, lights
// attach there).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAMES_PER_SEGMENT, VIEWS, plancherDuModele, poseAt } from './poses.ts';

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

// A built model's street or courtyard runs through its middle; its edges carry arcades, curtains
// and pots. A camera there sees only what the roof shades, and the sun leaves the capture black
// (#1016: Sponza's `sol` pose sat inside a plant, its moving run ended behind a curtain, the
// arcade line standing at 10 % of the box's depth).
const STREET_HALF_WIDTH = 0.06;

test('a view at reference level keeps the camera in the middle of the model, moving or held', () => {
  const bounds = { min: { x: -15, y: -1, z: -9 }, max: { x: 15, y: 11, z: 9 } };
  const sx = bounds.max.x - bounds.min.x,
    sz = bounds.max.z - bounds.min.z;
  // Each view's pose and the moving run that starts on it (the campaign's 60 frames, one segment).
  const indices = Object.values(VIEWS).flatMap(({ index }) =>
    Array.from({ length: FRAMES_PER_SEGMENT }, (_, frame) => index + frame),
  );
  for (const index of indices) {
    const { position, target } = poseAt(bounds, index);
    // Reference level: the camera no higher than the point it looks at.
    if (position[1] > target[1]) continue;
    const across = Math.max(
      Math.abs(position[0] - target[0]) / sx,
      Math.abs(position[2] - target[2]) / sz,
    );
    assert.ok(
      across <= STREET_HALF_WIDTH + 1e-9,
      `pose ${index} is ${across.toFixed(3)} off the middle`,
    );
  }
});
