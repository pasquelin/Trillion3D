import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTriangleTree } from './triangleTree.ts';
import { capsulePass, type CapsuleContact } from './capsule.ts';

test('capsules separate from either side of walls and retain real point, surface and penetration', () => {
  const walls = [0, -4, -4, 0, 4, -4, 0, -4, 4, 0, 4, -4, 0, 4, 4, 0, -4, 4];
  for (const side of [-1, 1])
    for (const height of [0.5, 2]) {
      const capsule = { feet: new Float64Array([side * 0.2, 0, -2]), radius: 0.5, height };
      const seen: { depth: number; normal: number[]; surface: number[]; point: number[] }[] = [];
      const push = (contact: CapsuleContact) => {
        seen.push({
          depth: contact.depth,
          normal: [...contact.normal],
          surface: [...contact.surface],
          point: [...contact.point],
        });
        for (let k = 0; k < 3; k++) capsule.feet[k] += contact.normal[k] * contact.depth;
      };
      const tree = buildTriangleTree(walls);
      assert.equal(capsulePass(tree, capsule, push), true);
      assert.ok(seen.length > 0);
      assert.ok(Math.abs(capsule.feet[0] - side * 0.5) < 1e-12);
      assert.ok(Math.abs(seen[0].depth - 0.3) < 1e-12);
      assert.ok(Math.abs(seen[0].normal[0] - side) < 1e-12);
      assert.ok(Math.abs(seen[0].surface[0] - side) < 1e-12);
      assert.equal(seen[0].point[0], 0);
      assert.equal(
        capsulePass(tree, capsule, () => assert.fail('tangent capsule overlaps')),
        false,
      );
    }
});

test('piercing segments leave the shorter side of floors and preserve geometric normals', () => {
  const floor = buildTriangleTree([-4, 0, -4, -4, 0, 4, 4, 0, -4, 4, 0, -4, -4, 0, 4, 4, 0, 4]);
  for (const [start, direction, expected] of [
    [-0.8, 1, 0],
    [-1.8, -1, -2],
  ]) {
    const capsule = { feet: new Float64Array([0, start, 0]), radius: 0.5, height: 2 };
    assert.equal(
      capsulePass(floor, capsule, (contact) => {
        assert.ok(contact.depth > 0);
        assert.ok(Math.abs(contact.normal[1] - direction) < 1e-12);
        for (let k = 0; k < 3; k++) capsule.feet[k] += contact.normal[k] * contact.depth;
      }),
      true,
    );
    assert.ok(Math.abs(capsule.feet[1] - expected) < 1e-12);
  }
  assert.equal(
    capsulePass(buildTriangleTree([]), { feet: new Float64Array(3), radius: 0.5, height: 2 }, () =>
      assert.fail(),
    ),
    false,
  );
});

test('translated inclined surfaces separate piercing capsules along the shortest face normal', () => {
  const root = Math.SQRT1_2;
  for (const axis of [0, 2])
    for (const side of [-1, 1]) {
      const point = (u: number, v: number) =>
        axis === 0 ? [3 + u, 4 + u, 5 + v] : [3 + v, 4 + u, 5 + u];
      const tree = buildTriangleTree([
        ...point(-8, -8),
        ...point(8, -8),
        ...point(-8, 8),
        ...point(8, -8),
        ...point(8, 8),
        ...point(-8, 8),
      ]);
      const capsule = {
        feet: new Float64Array([3, side === 1 ? 3.2 : 2.2, 5]),
        radius: 0.5,
        height: 2,
      };
      let count = 0;
      capsulePass(tree, capsule, (touch) => {
        count++;
        assert.ok(Math.abs(touch.normal[1] - side * root) < 1e-12);
        assert.ok(Math.abs(touch.normal[axis] + side * root) < 1e-12);
        assert.ok(Math.abs(touch.surface[1] - side * root) < 1e-12);
        assert.ok(Math.abs(touch.surface[axis] + side * root) < 1e-12);
        for (let k = 0; k < 3; k++) capsule.feet[k] += touch.depth * touch.normal[k];
      });
      assert.ok(count > 0);
      const offset = capsule.feet[1] - 4 - (capsule.feet[axis] - (axis === 0 ? 3 : 5));
      const nearestEnd = side === 1 ? offset + 0.5 : offset + 1.5;
      assert.ok(Math.abs(nearestEnd * root - side * 0.5) < 1e-10);
    }
});

test('coplanar edge contacts and equal-depth penetrations keep the authored face orientation', () => {
  for (const reversed of [false, true]) {
    const corners = [
      [0, 0, 0],
      [0, 0, 4],
      [4, 0, 0],
    ];
    const tree = buildTriangleTree((reversed ? corners.toReversed() : corners).flat());
    const side = reversed ? -1 : 1;
    const edge = { feet: new Float64Array([-0.5, -1, 1]), radius: 1, height: 2 };
    assert.equal(
      capsulePass(tree, edge, (touch) => {
        assert.equal(touch.depth, 0.5);
        assert.deepEqual([...touch.normal], [-1, 0, 0]);
        assert.equal(touch.surface[1], side);
      }),
      true,
    );
    const piercing = { feet: new Float64Array([1, -1, 1]), radius: 0.5, height: 2 };
    assert.equal(
      capsulePass(tree, piercing, (touch) => {
        assert.equal(touch.depth, 1);
        assert.equal(touch.normal[1], side);
        assert.equal(touch.surface[1], side);
      }),
      true,
    );
  }
});

test('a pass uses its declared starting neighbourhood and discovers newly reached support on the next pass', () => {
  const tree = buildTriangleTree([
    -10, 10, -120, 10, 10, -120, 0, 10, -80, -10, -9, -120, 0, -9, -80, 10, -9, -120,
  ]);
  const capsule = { feet: new Float64Array([0, 0, -100]), radius: 1, height: 20 };
  const touched: number[] = [];
  const push = (touch: CapsuleContact) => {
    touched.push(touch.point[1]);
    for (let axis = 0; axis < 3; axis++) capsule.feet[axis] += touch.normal[axis] * touch.depth;
  };
  assert.equal(capsulePass(tree, capsule, push), true);
  assert.deepEqual(touched, [10]);
  assert.equal(capsule.feet[1], -10);
  touched.length = 0;
  assert.equal(capsulePass(tree, capsule, push), true);
  assert.deepEqual(touched, [-9]);
  assert.equal(capsule.feet[1], -9);
});
