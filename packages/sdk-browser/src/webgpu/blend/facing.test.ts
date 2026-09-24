import test from 'node:test';
import assert from 'node:assert/strict';
import { FACING_DROP, facingDiscarded, vertexFacing } from './facing.ts';
import { BLEND_SHADER } from './shader.ts';
import { WATER_SURFACE_WGSL } from '../water/surfaceWgsl.ts';

type Triangle = Parameters<typeof vertexFacing>[1];

/** Sides that draw the triangle, given the facing the rasteriser settles on. */
const drawnBy = (triangle: Triangle, front: boolean) =>
  [1, 2].filter((cull) => {
    const mode = vertexFacing(cull, triangle);
    return mode !== FACING_DROP && !facingDiscarded(mode, front);
  });

const ccw: Triangle = [
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
];

test('a certain triangle is decided by the vertex stage alone, by one side', () => {
  assert.equal(vertexFacing(1, ccw), FACING_DROP, 'the front side mode drops a front face');
  assert.equal(vertexFacing(2, ccw), 0, 'the other keeps it, nothing left to the fragment');
  const cw: Triangle = [ccw[0], ccw[2], ccw[1]];
  assert.equal(vertexFacing(1, cw), 0);
  assert.equal(vertexFacing(2, cw), FACING_DROP);
});

test('a flat triangle is never drawn by both sides nor dropped by both', () => {
  const flat: Triangle = [
    [0, 0, 1],
    [1, 1, 1],
    [2, 2, 1],
  ];
  // Exactly zero in float: left to the rasteriser's facing, whichever it is.
  for (const front of [true, false]) assert.equal(drawnBy(flat, front).length, 1);
});

test('a sliver the float sign cannot settle goes to the fragment stage', () => {
  const sliver: Triangle = [
    [-0.9, 0.3, 1],
    [0.9, 0.3 + 1e-6, 1],
    [0, 0.3, 1],
  ];
  assert.equal(vertexFacing(1, sliver), 1, 'kept, carrying its mode');
  assert.equal(vertexFacing(2, sliver), 2);
  for (const front of [true, false]) assert.equal(drawnBy(sliver, front).length, 1);
});

test('a corner behind the eye, or a NaN, is left to the rasteriser', () => {
  const behind: Triangle = [ccw[0], ccw[1], [0, 1, -1]];
  assert.equal(vertexFacing(1, behind), 1);
  const broken: Triangle = [ccw[0], ccw[1], [Number.NaN, 1, 1]];
  assert.equal(vertexFacing(2, broken), 2);
});

test('every triangle is drawn by exactly one side, whatever its shape', () => {
  let seed = 7;
  const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 8;
  for (let n = 0; n < 5000; n++) {
    const triangle = [0, 1, 2].map(() => [next(), next(), next()]) as unknown as Triangle;
    for (const front of [true, false]) {
      // A certain triangle: the rasteriser agrees with its sign; a doubtful one may say either.
      const mode = vertexFacing(1, triangle);
      if (mode !== 1 && (mode === FACING_DROP) !== front) continue;
      assert.equal(drawnBy(triangle, front).length, 1, JSON.stringify(triangle));
    }
  }
});

test('the blend module runs the facing test and discards on front_facing', () => {
  assert.match(BLEND_SHADER, /fn vertexFacing\(/);
  assert.match(BLEND_SHADER, /facingDiscarded\(in\.water>>16u,front\)/);
  assert.doesNotMatch(BLEND_SHADER, /fn vertexCulled\(/, 'one facing test, not two');
  assert.match(
    WATER_SURFACE_WGSL,
    /\(in\.water&65535u\)/,
    'the water rank stored without the mode',
  );
});
