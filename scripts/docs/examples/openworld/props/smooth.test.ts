import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bevelExtrude,
  partBounds,
  prop,
  roundedBox,
  SURFACES,
  torus,
  triangleCount,
} from './index.ts';
import { inwardFaces, propProblems } from './validate.ts';

const S = SURFACES.concrete;

test('bevelled shapes: rounded boxes, rounded extrusions and tori are closed, smooth and sized', () => {
  const rounded = roundedBox(S, [2, 1, 3], 0.2, 3),
    slab = bevelExtrude(
      S,
      [
        [0, 0],
        [4, 0],
        [4, 2],
        [0, 2],
      ],
      0.5,
      { bevel: 0.1, segments: 3, smooth: 1 },
    ),
    ring = torus(S, 1, 0.25, { segments: 24, sides: 8 });
  // Six faces of (2 × 3 + 1)² cells, two triangles each.
  assert.equal(triangleCount(rounded), 6 * 49 * 2);
  assert.equal(triangleCount(ring), 24 * 8 * 2);
  for (const [name, part] of [
    ['rounded', rounded],
    ['slab', slab],
    ['ring', ring],
  ] as const)
    assert.deepEqual(propProblems(prop(name, [part])), [], name);
  assert.equal(inwardFaces(rounded), 0);
  assert.equal(inwardFaces(slab), 0);
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  assert.deepEqual(
    partBounds([rounded]).map((p) => p.map(round)),
    [
      [-1, 0, -1.5],
      [1, 1, 1.5],
    ],
  );
  assert.deepEqual(partBounds([slab])[1].map(round)[2], 0.25);
  // Welded: the rounded box's faces share their seam vertices.
  assert.ok(rounded.positions.length / 3 < 6 * 64);
});
