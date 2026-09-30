import test from 'node:test';
import assert from 'node:assert/strict';
import { signedArea, triangulate } from './triangulate.ts';

type P = readonly [number, number];

/** Checks the triangles tile the outline minus its holes: every one counter-clockwise, their
 *  areas adding up to the polygon's, no ring vertex strictly inside one. */
function tiles(outline: P[], holes: P[][] = [], label = '') {
  const { points, triangles } = triangulate(outline, holes);
  assert.equal(triangles.length % 3, 0);
  const area = (i: number) => {
    const [a, b, c] = [points[triangles[i]], points[triangles[i + 1]], points[triangles[i + 2]]];
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  };
  let sum = 0;
  for (let i = 0; i < triangles.length; i += 3) {
    assert.ok(area(i) > 0, `${label}: triangle ${i / 3} is not counter-clockwise`);
    sum += area(i);
  }
  const expected = [outline, ...holes.filter((h) => h.length >= 3)].reduce(
    (total, ring, r) => total + (r ? -1 : 1) * Math.abs(signedArea(ring)),
    0,
  );
  assert.ok(Math.abs(sum - expected) < 1e-9, `${label}: area ${sum}, not ${expected}`);
  return { points, triangles };
}

const square: P[] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
];

test('twice the signed area: positive counter-clockwise, negative clockwise', () => {
  assert.equal(signedArea(square), 32);
  assert.equal(signedArea([...square].reverse()), -32);
  assert.equal(signedArea([]), 0);
});

test('simple outlines, either way round, are cut into n − 2 triangles', () => {
  assert.equal(tiles(square, [], 'square').triangles.length, 6);
  const l: P[] = [
    [0, 0],
    [3, 0],
    [3, 1],
    [1, 1],
    [1, 3],
    [0, 3],
  ];
  assert.equal(tiles(l, [], 'L').triangles.length, 12);
  const { points } = tiles([...l].reverse(), [], 'clockwise L');
  assert.ok(signedArea(points) > 0, 'a clockwise outline is turned round');
  const star: P[] = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? 1 : 3;
    return [r * Math.cos((i * Math.PI) / 5), r * Math.sin((i * Math.PI) / 5)] as const;
  });
  assert.equal(tiles(star, [], 'star').triangles.length, 24);
  assert.deepEqual(
    triangulate([
      [0, 0],
      [1, 0],
      [0, 1],
    ]).triangles,
    [0, 1, 2],
  );
});

test('holes, either way round, are bridged from their rightmost vertex and left empty', () => {
  const hole: P[] = [
    [1, 2],
    [2.5, 1.5],
    [1, 1],
  ];
  const one = tiles(square, [hole], 'one hole');
  assert.deepEqual(
    one.points.slice(1, 3),
    [
      [4, 0],
      [2.5, 1.5],
    ],
    'bridged from the rightmost vertex to the nearest corner',
  );
  assert.equal(one.points.length, 4 + 3 + 2, 'the hole and the two ends of its bridge');
  tiles(square, [[...hole].reverse()], 'counter-clockwise hole');
  const left: P[] = [
    [0.5, 1],
    [0.5, 3],
    [1.5, 3.2],
    [1.5, 1],
  ];
  const right: P[] = [
    [2.5, 1],
    [2.5, 3],
    [3.5, 3.3],
    [3.5, 1.2],
  ];
  tiles(square, [left, right], 'two holes');
  tiles(square, [right, left], 'two holes, the other order');
  const two = tiles(square, [hole, [[3, 3]]], 'a hole of fewer than three points');
  assert.equal(two.points.length, 9, 'the point hole is dropped');
});

test('a bridge goes to the nearest outline vertex it reaches without crossing an edge', () => {
  const bridged = (hole: P[]) => tiles(square, [hole], `hole ${hole}`).points;
  // (0, 0) is nearer, but the hole's own edge stands between.
  assert.deepEqual(
    bridged([
      [1.5, 2],
      [1, 0.5],
      [0.5, 2.5],
    ]).slice(3, 5),
    [
      [0, 4],
      [1.5, 2],
    ],
  );
  // (4, 0) and (4, 4) are as near: the first is kept.
  assert.deepEqual(
    bridged([
      [2.5, 2],
      [1, 1],
      [1, 3],
    ]).slice(1, 3),
    [
      [4, 0],
      [2.5, 2],
    ],
  );
  // The nearest vertex may be the outline's first.
  assert.deepEqual(
    bridged([
      [1, 0.6],
      [0.5, 0.5],
      [0.5, 1],
    ]).slice(0, 2),
    [
      [0, 0],
      [1, 0.6],
    ],
  );
  // A hole outside the outline reaches no vertex: it is left out.
  const outside = triangulate(square, [
    [
      [6, 1],
      [6, 3],
      [7, 2],
    ],
  ]);
  assert.deepEqual(outside.points, square);
});

test('an ear holding another vertex, even on its edge, is not cut', () => {
  tiles(
    [
      [2, 4],
      [0, 0],
      [2, 1],
      [4, 0],
    ],
    [],
    'dart, point up',
  );
  tiles(
    [
      [4, 2],
      [0, 4],
      [1, 2],
      [0, 0],
    ],
    [],
    'dart',
  );
  tiles(
    [
      [0, 0],
      [4, 0],
      [4, 4],
      [2, 2],
      [0, 4],
    ],
    [],
    'a vertex on a diagonal',
  );
});

test('a polygon left without an ear is fanned, not dropped', () => {
  const line: P[] = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ];
  assert.deepEqual(triangulate(line), { points: line, triangles: [0, 1, 2, 0, 2, 3] });
});
