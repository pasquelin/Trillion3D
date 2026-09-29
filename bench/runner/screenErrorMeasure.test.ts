import test from 'node:test';
import assert from 'node:assert/strict';
import { measureView, viewOf } from './screenErrorMeasure.ts';
import { screenErrorBound } from '../../packages/sdk-core/src/lod/screenErrorBound.ts';
import { screenErrorPass } from './screenErrorVerdict.ts';

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
const measure = (
  source: number[],
  drawn: number[],
  twoSided?: Uint8Array,
  drawnTwoSided?: Uint8Array,
) =>
  measureView({
    source: Float32Array.from(source),
    twoSided,
    drawn: Float32Array.from(drawn),
    drawnTwoSided,
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

test('a culled triangle cannot satisfy reverse coverage of a visible source surface', () => {
  const source = square(1, 10);
  const halfCulled = [
    ...source.slice(0, 9),
    ...source.slice(12, 15),
    ...source.slice(9, 12),
    ...source.slice(15),
  ];
  const measured = measure(source, halfCulled);
  assert.ok(measured.forward.points > 0);
  assert.ok(measured.reverse.max > 100, 'the culled half leaves a visible hole');
  assert.equal(screenErrorPass(measured, 8, [], 0), false);
});

test('a single-sided source triangle seen from behind is not counted, a double-sided one is', () => {
  const front = square(0.2, 5),
    behind = [...front.slice(3, 6), ...front.slice(0, 3), ...front.slice(6, 9)];
  const source = [...square(1, 10), ...behind];
  assert.ok(measure(source, square(1, 10)).reverse.max < 1e-9);
  const doubleSided = Uint8Array.of(0, 0, 1);
  assert.ok(measure(source, square(1, 10), doubleSided).reverse.max > 100);
});

test('a single-sided drawn triangle seen from behind neither hides nor counts, a double-sided one does', () => {
  // Each triangle of a square with two corners swapped: its back faces the camera.
  const back = (half: number, depth: number) =>
    square(half, depth).map((_, i, all) => all[i % 9 < 3 ? i + 3 : i % 9 < 6 ? i - 3 : i]);
  const holed = [...square(1, 10).slice(0, 9), ...back(2, 5)];
  const single = measure(square(1, 10), holed);
  assert.ok(single.forward.max < 1e-9, `${single.forward.max}`);
  assert.ok(single.reverse.max > 100, 'the hole shows through a back face');
  const double = measure(square(1, 10), holed, undefined, Uint8Array.of(0, 1, 1));
  assert.ok(double.forward.max > 100, 'a double-sided face in front of the source counts');
});
