import test from 'node:test';
import assert from 'node:assert/strict';
import { dropSphere } from './drop.ts';
import { capsulePass, type CapsuleContact } from './capsule.ts';
import { buildTriangleTree } from './triangleTree.ts';
const contact = () => ({
  point: new Float64Array(3),
  normal: new Float64Array(3),
  surface: new Float64Array(3),
  depth: 0,
});
test('sphere edge tangency is reported even when no triangle corner is in reach', () => {
  const touch = contact();
  assert.equal(dropSphere([1, 10, 3], 1, [0, 0, 0, 0, 6, 0, 0, 0, 6], 0, touch), 7);
  assert.ok(Math.hypot(touch.point[0], touch.point[1] - 3, touch.point[2] - 3) < 1e-12);
  assert.ok(Math.hypot(touch.normal[0] - 1, touch.normal[1], touch.normal[2]) < 1e-12);
});
test('a single triangle query cannot hit the following unrelated triangle or its first vertex', () => {
  const tri = [0, 0, 0, 6, 0, 0, 0, 0, 6, 20, 5, 20, 21, 5, 20, 20, 5, 21];
  assert.equal(dropSphere([20, 10, 20], 1, tri, 0, contact()), Infinity);
  assert.equal(dropSphere([13, 10, 10], 1, tri, 0, contact()), Infinity);
});
test('degenerate triangle points preserve an actual separating surface direction', () => {
  const tree = buildTriangleTree([3, 4, 5, 3, 4, 5, 3, 4, 5]);
  const capsule = { feet: new Float64Array([3.3, 3.5, 5]), radius: 0.5, height: 1 };
  let seen = 0;
  assert.equal(
    capsulePass(tree, capsule, (touch) => {
      seen++;
      assert.ok(Math.abs(touch.depth - 0.2) < 1e-12);
      assert.deepEqual([...touch.normal], [1, 0, 0]);
      assert.deepEqual([...touch.surface], [1, 0, 0]);
    }),
    true,
  );
  assert.equal(seen, 1);
});

test('perching on a floor edge raises the sphere vertically to exactly one radius from the contact', async () => {
  const { slide, freshReport } = await import('./characterMove.ts');
  const capsule = { feet: new Float64Array(3), radius: 1, height: 2 };
  const velocity = new Float64Array([2, -3, 4]);
  let seen = false;
  const point = new Float64Array([-0.48, 0.36, 0]);
  const world = {
    groundBelow: () => null,
    resolveCapsule: (_: unknown, push: (v: CapsuleContact) => void) => {
      if (seen) return false;
      seen = true;
      push({
        normal: new Float64Array([0.6, 0.8, 0]),
        surface: new Float64Array([0, 1, 0]),
        point,
        depth: 0.2,
      });
      return true;
    },
  };
  const report = freshReport({ ground: false, wall: false, impact: 0 });
  slide(
    world,
    { capsule, velocity },
    { onGround: true, maxSlope: Math.PI / 4, stepTop: 1 },
    [0, 0, 0],
    report,
  );
  assert.equal(capsule.feet[0], 0);
  assert.equal(capsule.feet[2], 0);
  assert.ok(Math.abs(Math.hypot(0.48, capsule.feet[1] + 1 - 0.36) - 1) < 1e-12);
  assert.deepEqual([...velocity], [2, 0, 4]);
  assert.deepEqual(report, { ground: true, wall: false, impact: 3 });
});

test('a long movement cannot tunnel across a thin triangle wall and keeps tangential travel', async () => {
  const { slide, freshReport } = await import('./characterMove.ts');
  const { triangleCollision } = await import('./characterCollision.ts');
  const tree = buildTriangleTree([
    1, -20, -20, 1, 20, -20, 1, -20, 20, 1, 20, -20, 1, 20, 20, 1, -20, 20,
  ]);
  const capsule = { feet: new Float64Array([0, 0, -2]), radius: 0.5, height: 2 };
  const velocity = new Float64Array([100, 0, 10]);
  const report = freshReport({ ground: false, wall: false, impact: 0 });
  slide(
    triangleCollision(tree),
    { capsule, velocity },
    { onGround: false, maxSlope: Math.PI / 4, stepTop: Infinity },
    [10, 0, 1],
    report,
  );
  assert.ok(Math.abs(capsule.feet[0] - 0.5) < 1e-10);
  assert.ok(Math.abs(capsule.feet[2] + 1) < 1e-10);
  assert.deepEqual([...velocity], [0, 0, 10]);
  assert.equal(report.wall, true);
});

test('translated sloped face contacts commute with exchanging the horizontal axes', () => {
  for (const swap of [false, true]) {
    const place = (x: number, y: number, z: number) =>
      swap ? [z + 3, y + 4, x + 5] : [x + 3, y + 4, z + 5];
    const triangle = [...place(0, 0, 0), ...place(8, 0, 0), ...place(0, 8, 8)];
    const touch = contact();
    assert.ok(
      Math.abs(dropSphere(place(2, 10, 2), 1, triangle, 0, touch) - (8 - Math.SQRT2)) < 1e-10,
    );
    const expected = place(2, 2 + Math.SQRT1_2, 2 + Math.SQRT1_2);
    touch.point.forEach((value, k) => assert.ok(Math.abs(value - expected[k]) < 1e-10));
  }
});

test('ray leaves containing behind, coplanar and degenerate triangles still return the real forward face', async () => {
  const { nearestTriangleOnRay } = await import('./triangleQuery.ts');
  const tree = buildTriangleTree([
    -3, -3, -5, 3, -3, -5, -3, 3, -5, -3, -3, 10, 3, -3, 10, -3, 3, 10, -1, -1, 2, -1, -1, 2, -1,
    -1, 2, -1, -3, 3, -1, 3, 3, -1, -3, 7,
  ]);
  const hit = nearestTriangleOnRay(tree, [-1, -1, 0], [0, 0, 1]);
  assert.equal(hit?.t, 10);
  assert.equal(tree.triangles[hit!.at + 2], 10);
});

test('large-radius capsules detect surfaces on both sides beyond one metre', () => {
  for (const side of [-1, 1]) {
    const x = 3 + side * 1.5;
    const tree = buildTriangleTree([x, -8, -3, x, 8, -3, x, -8, 13]);
    const capsule = { feet: new Float64Array([3, -2, 5]), radius: 2, height: 4 };
    let count = 0;
    assert.equal(
      capsulePass(tree, capsule, (touch) => {
        count++;
        assert.ok(Math.abs(touch.depth - 0.5) < 1e-12);
        assert.ok(Math.abs(touch.normal[0] + side) < 1e-12);
      }),
      true,
    );
    assert.equal(count, 1);
  }
});

test('spatially separated leaves keep every nearest crossing in translated nonuniform boxes', async () => {
  const { nearestTriangleOnRay } = await import('./triangleQuery.ts');
  const points = [
    [-40, 8, -20],
    [3, -12, 50],
    [20, 30, 7],
    [-5, -4, 3],
    [60, 2, -8],
    [10, -30, 9],
    [-20, 40, 11],
    [80, -10, 40],
    [30, 15, -50],
  ];
  points.push(...points.map(([x, y, z]) => [x + 100, y - 100, z + 50]));
  const tree = buildTriangleTree(
    points.flatMap(([x, y, z]) => [x, y, z, x + 1, y, z, x, y + 1, z]),
  );
  for (const [x, y, z] of points)
    for (const sign of [-1, 1]) {
      const hit = nearestTriangleOnRay(tree, [x + 0.2, y + 0.2, z - sign * 4], [0, 0, sign * 2]);
      assert.equal(hit?.t, 2);
      assert.equal(tree.triangles[hit!.at], x);
      assert.equal(tree.triangles[hit!.at + 1], y);
      assert.equal(tree.triangles[hit!.at + 2], z);
    }
});

test('zero-thickness and degenerate coincident contacts never report a positive-volume overlap', () => {
  const floor = buildTriangleTree([-4, 0, -4, -4, 0, 4, 4, 0, -4]);
  assert.equal(
    capsulePass(floor, { feet: new Float64Array([-0.1, -1, -0.2]), radius: 0, height: 2 }, () =>
      assert.fail('a zero-radius line has no penetration volume'),
    ),
    false,
  );
  const point = buildTriangleTree([3, 4, 5, 3, 4, 5, 3, 4, 5]);
  capsulePass(point, { feet: new Float64Array([3, 3.5, 5]), radius: 0.5, height: 1 }, (touch) =>
    assert.ok(touch.depth > 0, 'reported contacts must have strictly positive depth'),
  );
});

test('the upper capsule cap detects a ceiling well above its lower sphere', () => {
  const ceiling = buildTriangleTree([-4, 3.75, -4, -4, 3.75, 4, 4, 3.75, -4]);
  const capsule = { feet: new Float64Array([0, 0, -1]), radius: 0.5, height: 4 };
  let count = 0;
  assert.equal(
    capsulePass(ceiling, capsule, (touch) => {
      count++;
      assert.equal(touch.depth, 0.25);
      assert.deepEqual([...touch.normal], [0, -1, 0]);
    }),
    true,
  );
  assert.equal(count, 1);
});
