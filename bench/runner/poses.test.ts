// Common formulas batch: modelFloor, factorized from 2 copies (camera lands there, lights
// attach there).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PATH_POSES, STREET_REACH, modelFloor, poseAt, type Bounds } from './poses.ts';

test('modelFloor falls back to zero plane when geometry spans the floor', () => {
  assert.equal(modelFloor({ min: { y: -2 }, max: { y: 5 } }), 0);
});

test('modelFloor takes box bottom when everything is above or below floor', () => {
  assert.equal(modelFloor({ min: { y: 2 }, max: { y: 8 } }), 2);
  assert.equal(modelFloor({ min: { y: -8 }, max: { y: -2 } }), -8);
});

test('modelFloor with exact bounds (min or max at zero) does not cross the plane', () => {
  // min.y === 0 is not "< 0": the box does not span it, floor remains min.y.
  assert.equal(modelFloor({ min: { y: 0 }, max: { y: 5 } }), 0);
  // max.y === 0 is not "> 0": same rule on opposite edge.
  assert.equal(modelFloor({ min: { y: -5 }, max: { y: 0 } }), -5);
});

// Boxes of three kinds: a courtyard, a tower taller than 66 m (eye clamped to 2 m), a flat slab
// (eye set by its footprint); each walked with no street, and with a street off its centre.
const BOXES = [
  { min: { x: -15, y: -1, z: -9 }, max: { x: 15, y: 11, z: 9 } },
  { min: { x: -20, y: 0, z: -20 }, max: { x: 20, y: 120, z: 20 } },
  { min: { x: -400, y: 0, z: -300 }, max: { x: 400, y: 4, z: 300 } },
];
const walked: Bounds[] = BOXES.flatMap((box) => [
  box,
  { ...box, street: { x: box.min.x / 2, z: box.max.z / 3, ground: box.min.y + 1, clearance: 3 } },
]);

test('every pose of the path walks the street it was given, or flies above the model', () => {
  for (const bounds of walked) {
    const road = bounds.street ?? { x: 0, z: 0, ground: 0, clearance: 0 };
    for (let index = 0; index < PATH_POSES; index++) {
      const [x, y, z] = poseAt(bounds, index).position;
      // 1e-9: a share interpolated onto the reach's edge lands a rounding above it.
      const reach = STREET_REACH * road.clearance * Math.SQRT2 + 1e-9;
      const inStreet = Math.hypot(x - road.x, z - road.z) <= reach && y >= road.ground;
      assert.ok(inStreet || y >= bounds.max.y, `pose ${index}: ${x}, ${y}, ${z}`);
    }
  }
});

test('an index past the path wraps round the loop', () => {
  for (const offset of [0, 1, 59, 359, 599])
    assert.deepEqual(poseAt(walked[1], PATH_POSES + offset), poseAt(walked[1], offset));
});
