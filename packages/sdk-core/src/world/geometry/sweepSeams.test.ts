import test from 'node:test';
import assert from 'node:assert/strict';
import { lathe, capsule, tube } from './round.ts';
import { Curve } from '../math/curves.ts';
import { Vector3 } from '../math/vector3.ts';

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

class Parabola extends Curve {
  getPoint(t: number, out = new Vector3()) {
    return out.set(t, t * t, t * t * t);
  }
}

test('open curved tubes use one-sided endpoint tangents and preserve their centres', () => {
  const path = new Parabola();
  const g = tube(path, 4, 0.2, 8, false);
  const p = g.attributes.position,
    n = g.attributes.normal;
  for (const endpoint of [0, 4]) {
    const t = endpoint / 4;
    const centre = path.getPoint(t);
    const tangent =
      endpoint === 0 ? path.getPoint(0.25).sub(centre) : centre.clone().sub(path.getPoint(0.75));
    for (let ring = 0; ring <= 8; ring++) {
      const i = ring * 5 + endpoint;
      const normal = new Vector3(n.getX(i), n.getY(i), n.getZ(i));
      assert.ok(Math.abs(normal.dot(tangent)) < 1e-9);
      assert.ok(Math.abs(p.getX(i) - centre.x - 0.2 * normal.x) < 1e-9);
      assert.ok(Math.abs(p.getY(i) - centre.y - 0.2 * normal.y) < 1e-9);
      assert.ok(Math.abs(p.getZ(i) - centre.z - 0.2 * normal.z) < 1e-9);
    }
  }
});

class BoundaryDirection extends Curve {
  getPoint(t: number, out = new Vector3()) {
    return out.set(0.9 * t, Math.sqrt(0.19) * t, 0);
  }
}

test('tube cross sections retain their seam direction and complete longitudinal UVs', () => {
  const g = tube(new BoundaryDirection(), 2, 0.5, 3);
  const p = g.attributes.position,
    uv = g.attributes.uv;
  assert.ok(Math.abs(p.getX(0) + 0.5 * Math.sqrt(0.19)) < 1e-9);
  assert.ok(Math.abs(p.getY(0) - 0.45) < 1e-9);
  assert.equal(uv.count, 12);
  for (let ring = 0; ring <= 3; ring++) {
    for (let along = 0; along <= 2; along++) {
      const vertex = ring * 3 + along;
      assert.equal(uv.getX(vertex), along / 2);
      assert.equal(uv.getY(vertex), ring / 3);
    }
  }
});

test('closed tubes follow each interior tangent instead of reusing the closing tangent', () => {
  const path = new Parabola();
  const g = tube(path, 4, 0.2, 4, true);
  const n = g.attributes.normal;
  const tangent = path.getPoint(0.5).sub(path.getPoint(0));
  for (let ring = 0; ring <= 4; ring++) {
    const i = ring * 5 + 1;
    assert.ok(
      Math.abs(n.getX(i) * tangent.x + n.getY(i) * tangent.y + n.getZ(i) * tangent.z) < 1e-9,
    );
  }
});
