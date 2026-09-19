import { copyMatrix4, type NumberSink } from './mathMatrix4.ts';
import { transformHomogeneousPoint } from './mathVector.ts';

/**
 * THE RENDER FRAME. A scene posed far from the world origin shimmers: the GPU
 * composes `view · world` in single precision, and two numbers on the order of 50 km that almost
 * cancel leave only a few millimetres of correct digits. Each frame the camera moves
 * a little, the cancellation does not land in the same place, and the surface shivers.
 *
 * THE RULE. The CPU works in double precision, where 50 km still leave the micrometre:
 * so it, and it alone, subtracts the eye position. The view loses its translation, each
 * world matrix has its own brought back to the eye, and the product `relativeView · relativeWorld`
 * equals, in exact arithmetic, the previous `view · world` — the subtraction cancels term by term.
 * What then goes to single precision carries only numbers the size of the VISIBLE
 * scene, not of its distance to the origin: the shimmer disappears.
 *
 * THE CONSTRAINT. A formula changes frame entirely or not at all: a relative operand and an
 * absolute operand in the same sum is a defect, never an approximation. A world position
 * that stays in double precision on the CPU has nothing to change.
 *
 * THE ORIGIN is the eye position of the frame, and nothing else. Camera at the world origin, the
 * subtraction yields the same bits as no subtraction: the image does not change.
 */

/**
 * Writes `world` with its translation brought back to `origin`. The subtraction is done in the
 * precision of the inputs — the double of the engine world matrices — and writing a single-precision
 * buffer rounds AFTER it, never before: that is all that separates a sharp image from one that
 * shivers. `at` is the rank of the first of the sixteen numbers written, so a buffer of several
 * matrices fills without slicing a view per matrix and per frame.
 */
export function worldToRenderOrigin<T extends NumberSink>(
  out: T,
  world: ArrayLike<number>,
  origin: ArrayLike<number>,
  at = 0,
) {
  copyMatrix4(out, world, at);
  out[at + 12] = world[12] - origin[0];
  out[at + 13] = world[13] - origin[1];
  out[at + 14] = world[14] - origin[2];
  return out;
}

/**
 * Writes `m · T(origin)`: the same matrix, applied to a point referred to `origin`. Only the
 * fourth column changes, and it equals `m · (origin, 1)` — computed in the precision of the inputs
 * before the write rounding, so the composition adds no error beyond what the
 * kernel already bounds. `at` as above.
 */
export function matrixAtRenderOrigin<T extends NumberSink>(
  out: T,
  m: ArrayLike<number>,
  origin: ArrayLike<number>,
  at = 0,
) {
  copyMatrix4(out, m, at);
  return transformHomogeneousPoint(out, m, origin[0], origin[1], origin[2], at + 12);
}

/**
 * Writes `view` without its translation: the view of a camera of the same orientation posed at the
 * origin of the render frame. This is the exact counterpart of `worldToRenderOrigin` — the view
 * translation is the image of the eye by the linear part, and the relative world already carries it.
 */
export function viewToRenderOrigin<T extends NumberSink>(out: T, view: ArrayLike<number>) {
  copyMatrix4(out, view);
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  return out;
}
