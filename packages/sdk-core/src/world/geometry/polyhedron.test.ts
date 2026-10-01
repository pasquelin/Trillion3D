import test from 'node:test';
import assert from 'node:assert/strict';
import { polyhedron } from './polyhedron.ts';

test('polyhedron subdivision covers a spherical octant without duplicate or reversed faces', () => {
  const vertices = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (const detail of [0, 1, 2, 3]) {
    const g = polyhedron(vertices, [0, 1, 2], 3, detail),
      p = g.attributes.position,
      n = g.attributes.normal,
      uv = g.attributes.uv;
    assert.equal(p.count, 3 * (detail + 1) ** 2);
    assert.equal(g.index!.count, 3 * (detail + 1) ** 2);
    const faces = new Set<string>();
    for (let i = 0; i < p.count; i++) {
      assert.ok(Math.abs(Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) - 3) < 1e-6);
      assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-6);
      assert.ok(p.getX(i) >= 0 && p.getY(i) >= 0 && p.getZ(i) >= 0);
      assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0.5 && uv.getY(i) <= 1);
      if (detail > 0)
        for (const axis of ['X', 'Y', 'Z'] as const)
          assert.ok(Math.abs(p[`get${axis}`](i) - 3 * n[`get${axis}`](i)) < 1e-6);
    }
    for (let i = 0; i < g.index!.count; i += 3) {
      const ids = Array.from(g.index!.array.slice(i, i + 3));
      const points = ids.map((v) => [p.getX(v), p.getY(v), p.getZ(v)]);
      faces.add(
        points
          .map((v) => v.join(','))
          .sort()
          .join(';'),
      );
      const [a, b, c] = points,
        ab = b.map((v, k) => v - a[k]),
        ac = c.map((v, k) => v - a[k]);
      const cross = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      assert.ok(cross.reduce((s, v, k) => s + v * a[k], 0) > 0);
    }
    assert.equal(faces.size, (detail + 1) ** 2);
  }
  const flat = polyhedron(vertices, [0, 1, 2]);
  assert.deepEqual([...flat.attributes.uv.array], [1, 0.5, 1, 1, 0.75, 0.5]);
  assert.equal(polyhedron(vertices, [0, 1, 2, 0, 2, 1], 1, 1).index!.count, 24);
});
