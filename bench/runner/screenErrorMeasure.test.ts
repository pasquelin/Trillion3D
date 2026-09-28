import test from 'node:test';
import assert from 'node:assert/strict';
import { measureView, viewOf } from './screenErrorMeasure.ts';
import { screenErrorBound } from '../../packages/sdk-core/src/lod/screenErrorBound.ts';

const pose = {
  position: [0, 0, 0] as [number, number, number],
  target: [0, 0, -1] as [number, number, number],
  fov: 55,
  near: 0.1,
  far: 100,
};
const SHIFT = 2 ** -6;
/** A square of half side `half` facing the camera at depth `depth`, two triangles. */
const square = (half: number, depth: number) =>
  // prettier-ignore
  [-half, -half, -depth, half, -half, -depth, half, half, -depth,
   -half, -half, -depth, half, half, -depth, -half, half, -depth];
const measure = (source: number[], drawn: number[]) =>
  measureView({
    source: Float32Array.from(source),
    drawn: Float32Array.from(drawn),
    pose,
    width: 1000,
    height: 1000,
  });

test('a drawn surface moved away from the camera measures the cut projection of the move', () => {
  const { focal, near } = viewOf(pose, 1000, 1000);
  const { forward, reverse } = measure(square(1, 10), square(1, 10 + SHIFT));
  // The corners lie farthest from the axis: the largest error of both directions is theirs.
  const at = (depth: number) => screenErrorBound(SHIFT, 1, Math.SQRT2, depth, 0, focal, near);
  assert.ok(Math.abs(forward.max - at(10 + SHIFT)) < 1e-9, `${forward.max}`);
  assert.ok(Math.abs(reverse.max - at(10)) < 1e-9, `${reverse.max}`);
});

test('a source surface hidden behind the drawn one is not counted, a hole is', () => {
  const hiddenBehind = [...square(1, 10), ...square(1.5, 20)];
  assert.ok(measure(hiddenBehind, square(1, 10)).reverse.max < 1e-9);
  const holed = square(1, 10).slice(0, 9);
  assert.ok(measure(hiddenBehind, holed).reverse.max > 100);
});
