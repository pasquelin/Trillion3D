import test from 'node:test';
import assert from 'node:assert/strict';
import { arc, freshReport, isFloor, slide } from './characterMove.ts';
import type { CapsuleContact } from './capsule.ts';

const rules = { maxSlope: Math.PI / 4, onGround: false, stepTop: 1 };
const contact = (normal: number[], surface = normal, y = 0): CapsuleContact => ({
  normal: new Float64Array(normal),
  surface: new Float64Array(surface),
  point: new Float64Array([0, y, 0]),
  depth: 0.2,
});
const close = (actual: ArrayLike<number>, expected: number[]) =>
  Array.from(actual).forEach((v, k) =>
    assert.ok(Math.abs(v - expected[k]) < 1e-10, `${v} != ${expected[k]}`),
  );

test('floor classification respects the normal, supporting face and exact step height', () => {
  assert.equal(isFloor(contact([0, 1, 0], [1, 0, 0], 1), rules), true);
  assert.equal(isFloor(contact([0.8, 0.6, 0], [0, 1, 0]), rules), true);
  assert.equal(isFloor(contact([0.8, 0.6, 0]), rules), false);
  assert.equal(isFloor(contact([0, -1, 0], [0, 1, 0]), rules), false);
  assert.equal(isFloor(contact([1, 0, 0], [0, 1, 0]), rules), false);
  assert.equal(isFloor(contact([0, 1, 0], [0, 1, 0], 1.001), rules), false);
  assert.equal(isFloor(contact([0, 1, 0]), { ...rules, maxSlope: 0 }), true);
});

test('airborne oblique contacts remove inward velocity and preserve outward and tangent motion', () => {
  for (const normal of [
    [0.6, 0, 0.8],
    [0.6, -0.8, 0],
    [0, -0.6, 0.8],
  ]) {
    for (const sign of [-1, 1]) {
      const capsule = { feet: new Float64Array(3), radius: 1, height: 2 };
      const velocity = new Float64Array(normal.map((v) => v * sign * 5));
      let called = false;
      const world = {
        groundBelow: () => null,
        resolveCapsule: (_: unknown, push: (value: CapsuleContact) => void) => {
          if (called) return false;
          called = true;
          push(contact(normal));
          return true;
        },
      };
      const report = freshReport({ ground: true, wall: true, impact: 1 });
      slide(world, { capsule, velocity }, rules, [0, 0, 0], report);
      close(
        capsule.feet,
        normal.map((v) => v * 0.2),
      );
      close(
        velocity,
        normal.map((v) => (sign < 0 ? 0 : v * 5)),
      );
      assert.equal(report.ground, false);
      assert.equal(report.wall, normal[1] >= 0);
      assert.equal(report.impact, -Infinity);
    }
  }
});

test('a grounded steep contact moves horizontally and clips the remaining movement', () => {
  const capsule = { feet: new Float64Array(3), radius: 1, height: 2 };
  const velocity = new Float64Array([-3, 0, -4]);
  let calls = 0;
  const world = {
    groundBelow: () => null,
    resolveCapsule: (_: unknown, push: (value: CapsuleContact) => void) => {
      calls++;
      if (calls > 2) return false;
      push(contact([0.48, 0.6, 0.64]));
      return true;
    },
  };
  const report = freshReport({ ground: false, wall: false, impact: 0 });
  slide(world, { capsule, velocity }, { ...rules, onGround: true }, [-0.6, 0, -0.8], report);
  close(capsule.feet, [-0.15, 0, -0.2]);
  close(velocity, [0, 0, 0]);
  assert.equal(report.wall, true);
  assert.equal(report.ground, false);
});

test('vertical arcs resolve the apex and use separate ascending and falling acceleration', () => {
  close(arc(4, 0.25, 8, 16), [0.75, 2]);
  close(arc(4, 0.75, 8, 16), [0.5, -4]);
  close(arc(-2, 0.5, 8, 16), [-3, -10]);
  close(arc(0, 0.5, 8, 16), [-2, -8]);
});

test('a grounded body leaves an oblique ceiling along its normal rather than being lifted or shoved sideways', () => {
  const capsule = { feet: new Float64Array(3), radius: 1, height: 2 };
  const velocity = new Float64Array([-3, 4, 0]);
  const normal = [0.6, -0.8, 0];
  const world = {
    groundBelow: () => null,
    resolveCapsule: (_: unknown, push: (value: CapsuleContact) => void) => {
      const remaining = 0.2 - capsule.feet[0] * normal[0] - capsule.feet[1] * normal[1];
      if (remaining < 1e-12) return false;
      push({ ...contact(normal, normal, 2), depth: remaining });
      return true;
    },
  };
  slide(
    world,
    { capsule, velocity },
    { ...rules, onGround: true },
    [0, 0, 0],
    freshReport({ ground: false, wall: false, impact: 0 }),
  );
  close(capsule.feet, [0.12, -0.16, 0]);
  close(velocity, [0, 0, 0]);
});

test('a vertical overlap above the step limit has a finite upward escape when no horizontal direction exists', () => {
  const capsule = { feet: new Float64Array([0, 3, 0]), radius: 1, height: 2 };
  const velocity = new Float64Array([0, -2, 0]);
  const world = {
    groundBelow: () => null,
    resolveCapsule: (_: unknown, push: (value: CapsuleContact) => void) => {
      const depth = 3.2 - capsule.feet[1];
      if (depth < 1e-12) return false;
      push({ ...contact([0, 1, 0], [0, 1, 0], 3.2), depth });
      return true;
    },
  };
  slide(
    world,
    { capsule, velocity },
    { ...rules, onGround: true, stepTop: 3 },
    [0, 0, 0],
    freshReport({ ground: false, wall: false, impact: 0 }),
  );
  close(capsule.feet, [0, 3.2, 0]);
  close(velocity, [0, 0, 0]);
});
