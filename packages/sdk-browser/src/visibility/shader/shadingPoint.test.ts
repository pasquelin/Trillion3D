import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';
import { SHADING_POINT_WGSL } from './shadingPoint.ts';

type V = number[];
const { shadingPointOffset } = shaderRun<{
  shadingPointOffset: (...vectors: V[]) => V;
}>(SHADING_POINT_WGSL, ['shadingPointOffset'], {});
const dot = (a: V, b: V) => a.reduce((v, x, i) => v + x * b[i], 0);
const unit = (a: V) => a.map((x) => x / Math.hypot(...a));

test('receiver projects onto interpolated vertex tangent planes and keeps flat surfaces exact', () => {
  const vertices = [
    [0, 0, 0],
    [2, 0, 0],
    [0, 2, 0],
  ];
  const bary = [0.2, 0.3, 0.5];
  const P = [0.6, 1, 0];
  const normal = [0, 0, 1];
  assert.deepEqual(
    shadingPointOffset(P, bary, ...vertices, normal, normal, normal).map(Math.abs),
    [0, 0, 0],
  );
  const normals = [
    [-0.3, -0.3, 1],
    [0.3, 0, 1],
    [0, 0.3, 1],
  ].map(unit);
  const actual = shadingPointOffset(P, bary, ...vertices, ...normals);
  // Independent construction: each tangent-plane projection, then barycentric interpolation.
  const projected = vertices.map((v, i) => {
    const signedDistance = dot(
      P.map((x, j) => x - v[j]),
      normals[i],
    );
    return P.map((x, j) => x - signedDistance * normals[i][j]);
  });
  actual.forEach((offset, j) => {
    const expected = projected.reduce((v, q, i) => v + bary[i] * q[j], 0);
    assert.ok(Math.abs(P[j] + offset - expected) < 1e-12);
  });
  assert.ok(actual[2] > 0, 'a convex smooth patch raises the shadow receiver');
  const flipped = shadingPointOffset(P, bary, ...vertices, ...normals.map((n) => n.map((x) => -x)));
  assert.deepEqual(flipped, actual, 'two-sided normal sign does not move the projected position');
  assert.deepEqual(
    shadingPointOffset(vertices[0], [1, 0, 0], ...vertices, ...normals).map(Math.abs),
    [0, 0, 0],
  );
});

test('degenerate normals and world translations preserve a finite receiver displacement', () => {
  const p = [4, 5, 6],
    zero = [0, 0, 0];
  assert.deepEqual(shadingPointOffset(p, [1, 0, 0], p, p, p, zero, zero, zero).map(Math.abs), zero);
  const vertices = [
      [0, 0, 0],
      [2, 0, 0],
      [0, 2, 0],
    ],
    bary = [0.25, 0.25, 0.5];
  const normals = [
    [0, 0, 1],
    [0.2, 0, 1],
    [0, 0.2, 1],
  ].map(unit);
  const point = [0.5, 1, 0],
    translation = [128, -64, 32];
  const move = (v: V) => v.map((x, i) => x + translation[i]);
  assert.deepEqual(
    shadingPointOffset(move(point), bary, ...vertices.map(move), ...normals),
    shadingPointOffset(point, bary, ...vertices, ...normals),
  );
});
