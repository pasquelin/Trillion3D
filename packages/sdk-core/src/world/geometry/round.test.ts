import test from 'node:test';
import assert from 'node:assert/strict';
import { SplineCurve, Path, Curve } from '../math/curves.ts';
import { Vector3 } from '../math/vector3.ts';
import { torusKnot, tube, torus, lathe, capsule } from './round.ts';
import { RECIPES } from './recipes.ts';

/** Every vertex of the last ring of a `(tubular + 1) × (radial + 1)` sweep sits on the first's. */
function assertCloses(position: ArrayLike<number>, tubular: number, radial: number) {
  for (let j = 0; j <= radial; j++) {
    const [first, last] = [j * (tubular + 1) * 3, (j * (tubular + 1) + tubular) * 3];
    for (let k = 0; k < 3; k++)
      assert.ok(Math.abs(position[first + k] - position[last + k]) < 1e-9, `ring vertex ${j}`);
  }
}

test('a torus knot closes: its last ring lands on its first, vertex for vertex', () => {
  const [tubular, radial] = [480, 40];
  assertCloses(
    torusKnot(1.5, 0.34, tubular, radial, 2, 3).attributes.position.array,
    tubular,
    radial,
  );
});

test('a closed tube along a curve out of any plane closes on itself', () => {
  const points = [
    [1, 0, 0],
    [0, 1, 0.6],
    [-1, 0, 0],
    [0, -1, -0.8],
    [0.4, 0.3, 1],
  ].map(([x, y, z]) => new Vector3(x, y, z));
  assertCloses(
    tube(new SplineCurve(points, true), 64, 0.1, 8, true).attributes.position.array,
    64,
    8,
  );
});

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('torus tube lies at the declared distance from its central circle, with outward normals', () => {
  for (const arc of [Math.PI, Math.PI * 2]) {
    const g = torus(5, 2, 4, 8, arc),
      p = g.attributes.position,
      n = g.attributes.normal,
      uv = g.attributes.uv;
    assert.equal(p.count, 45);
    assert.equal(g.index!.count, 192);
    assert.equal(RECIPES[g.recipe!.type], torus);
    assert.deepEqual(g.recipe!.args, [5, 2, 4, 8, arc]);
    for (let i = 0; i < p.count; i++) {
      near(Math.hypot(Math.hypot(p.getX(i), p.getY(i)) - 5, p.getZ(i)), 2);
      near(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)), 1);
      near(p.getZ(i), 2 * n.getZ(i));
      const cx = p.getX(i) - 2 * n.getX(i),
        cy = p.getY(i) - 2 * n.getY(i);
      near(Math.hypot(cx, cy), 5);
      assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1);
    }
    near(p.getX(0), 7);
    near(p.getY(0), 0);
    near(p.getZ(9), 2);
    near(p.getX(8), arc === Math.PI ? -7 : 7);
    assert.equal(uv.getX(8), 1);
    assert.equal(uv.getY(36), 1);
  }
});

test('lathe spins translated profiles with slope normals and partial-arc endpoints', () => {
  const profile: [[number, number], [number, number], [number, number]] = [
    [2, -3],
    [3, 0],
    [4, 3],
  ];
  const g = lathe(profile, 4, Math.PI / 2, Math.PI),
    p = g.attributes.position,
    n = g.attributes.normal;
  const object = lathe(
    profile.map(([x, y]) => ({ x, y })),
    4,
    Math.PI / 2,
    Math.PI,
  );
  assert.deepEqual(object.attributes.position.array, p.array);
  assert.equal(p.count, 15);
  assert.equal(g.index!.count, 48);
  for (let i = 0; i < p.count; i++) {
    near(Math.hypot(p.getX(i), p.getZ(i)), [2, 3, 4][Math.floor(i / 5)]);
    near(p.getY(i), [-3, 0, 3][Math.floor(i / 5)]);
    near(n.getY(i), -1 / Math.sqrt(10));
    near(Math.hypot(n.getX(i), n.getZ(i)), 3 / Math.sqrt(10));
    near(n.getX(i) * p.getZ(i) - n.getZ(i) * p.getX(i), 0);
  }
  near(p.getX(0), 2);
  near(p.getZ(0), 0);
  near(p.getX(4), -2);
  const uv = g.attributes.uv;
  assert.deepEqual(
    [...uv.array],
    [
      0, 0, 0.25, 0, 0.5, 0, 0.75, 0, 1, 0, 0, 0.5, 0.25, 0.5, 0.5, 0.5, 0.75, 0.5, 1, 0.5, 0, 1,
      0.25, 1, 0.5, 1, 0.75, 1, 1, 1,
    ],
  );
});

test('capsule rings join two hemispheres to the declared straight cylinder', () => {
  const g = capsule(2, 6, 2, 4),
    p = g.attributes.position;
  assert.equal(p.count, 30);
  assert.equal(g.index!.count, 120);
  assert.equal(RECIPES[g.recipe!.type], capsule);
  assert.deepEqual(g.recipe!.args, [2, 6, 2, 4]);
  for (let i = 0; i < p.count; i++) {
    const centreY = p.getY(i) < 0 ? -3 : 3;
    near(Math.hypot(p.getX(i), p.getY(i) - centreY, p.getZ(i)), 2);
  }
  near(p.getY(0), -5);
  near(p.getY(10), -3);
  near(p.getY(15), 3);
  near(p.getY(25), 5);
});

test('open tubes keep translated endpoints, radius and normals across either frame seed', () => {
  for (const end of [new Vector3(8, 2, 3), new Vector3(1, 9, 3), new Vector3(5, 7, 9)]) {
    const start = new Vector3(1, 2, 3),
      path = new Path([start, end]);
    const g = tube(path, 4, 0.5, 4),
      p = g.attributes.position,
      n = g.attributes.normal;
    assert.equal(p.count, 25);
    assert.equal(g.index!.count, 96);
    for (let i = 0; i < p.count; i++) {
      const centre = path.getPoint((i % 5) / 4),
        delta = new Vector3(p.getX(i), p.getY(i), p.getZ(i)).sub(centre);
      near(delta.length(), 0.5);
      near(delta.dot(end.clone().sub(start)), 0);
      near(delta.x, 0.5 * n.getX(i));
      near(delta.y, 0.5 * n.getY(i));
      near(delta.z, 0.5 * n.getZ(i));
    }
  }
  const knot = torusKnot(2, 0.25, 8, 4, 1, 2);
  assert.equal(RECIPES[knot.recipe!.type], torusKnot);
  assert.deepEqual(knot.recipe!.args, [2, 0.25, 8, 4, 1, 2]);
  assert.equal(knot.attributes.position.count, 45);
});

test('lathe angular UV direction and capsule lower hemisphere keep their declared seam', () => {
  const g = lathe(
    [
      [2, -1],
      [2, 1],
    ],
    4,
    0,
    Math.PI,
  );
  assert.ok(g.attributes.position.getX(1) > 1);
  assert.ok(g.attributes.position.getZ(1) > 1);
  const cap = capsule(2, 6, 4, 8);
  const p = cap.attributes.position;
  // The first longitude starts on positive Z, including the lower cap's rings.
  assert.ok(p.getZ(9) > 0);
  assert.ok(p.getY(9) > -5 && p.getY(9) < -3);
});

class Slanted extends Curve {
  getPoint(t: number, out = new Vector3()) {
    return out.set(3 * t, 4 * t, 0);
  }
}

test('tube UVs run around each ring and along the path, end to end', () => {
  const g = tube(new Slanted(), 2, 0.5, 3);
  const uv = g.attributes.uv;
  assert.equal(uv.count, 12);
  for (let ring = 0; ring <= 3; ring++) {
    for (let along = 0; along <= 2; along++) {
      const vertex = ring * 3 + along;
      assert.equal(uv.getX(vertex), along / 2);
      assert.equal(uv.getY(vertex), ring / 3);
    }
  }
});

test('a two-three torus knot passes its independently known crossing and height landmarks', () => {
  const g = torusKnot(2, 0.25, 8, 4, 2, 3),
    p = g.attributes.position;
  // Opposite vertices of the same tube ring have their midpoint on the centre curve.
  for (const [i, expected] of [
    [0, [3, 0, 0]],
    [2, [-2, 0, -1]],
    [4, [1, 0, 0]],
    [6, [-2, 0, 1]],
    [8, [3, 0, 0]],
  ] as const) {
    for (let c = 0; c < 3; c++)
      assert.ok(
        Math.abs((p.getComponent(i, c) + p.getComponent(18 + i, c)) / 2 - expected[c]) < 1e-8,
      );
  }
});
