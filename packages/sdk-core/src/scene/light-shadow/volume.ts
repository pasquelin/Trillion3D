import { hypot3 } from '../../math/primitives/hypot.ts';
import { faceBasis } from './math.ts';
import { PAGES } from './pageModel.ts';

/**
 * Rectangle of a region, in normalised face coordinates: `u0, u1, v0, v1`. The whole
 * face is `−1, 1, −1, 1`, and the volume it produces is then exactly that from before this
 * batch: the cone circumscribed to the square, or the box of the whole square of sun pages.
 */
export const FULL_FACE = new Float64Array([-1, 1, -1, 1]);

const axis = new Float64Array(3),
  corner = new Float64Array(3);

/** World direction of point `(u, v)` of the projection plane, frame of the last composed face. */
function direction(out: Float64Array, u: number, v: number, t: number) {
  let length = 0;
  for (let a = 0; a < 3; a++) {
    out[a] = PAGES.shadowConeRay(faceBasis[6 + a], faceBasis[a], faceBasis[3 + a], t, u, v);
    length += out[a] * out[a];
  }
  length = Math.sqrt(length) || 1;
  for (let a = 0; a < 3; a++) out[a] /= length;
}

/**
 * Cone that reject opposes to a region of a perspective face: the light as apex, the
 * direction of the region centre as axis, and the angle of the most offset of its four corners as
 * half-angle.
 *
 * This is exact, never a quality approximation: the projected image of a planar rectangle is
 * spherically convex, so the cap that contains its four corners contains the whole rectangle.
 * A discarded cluster could write nothing in the region, and the region comes out texel for texel as
 * if every cluster had been presented to it.
 */
export function writeConeVolume(
  cull: Float32Array,
  base: number,
  position: readonly number[],
  far: number,
  halfFov: number,
  rect: Float64Array,
) {
  cull[base] = position[0];
  cull[base + 1] = position[1];
  cull[base + 2] = position[2];
  cull[base + 3] = far;
  // A half-field beyond a quarter turn already covers all of space: the cone excludes nothing more.
  if (halfFov >= Math.PI / 2) {
    cull[base + 4] = faceBasis[6];
    cull[base + 5] = faceBasis[7];
    cull[base + 6] = faceBasis[8];
    cull[base + 7] = PAGES.shadowConeHalfAngle(0, halfFov);
    return;
  }
  const t = Math.tan(halfFov);
  direction(axis, (rect[0] + rect[1]) / 2, (rect[2] + rect[3]) / 2, t);
  let chord = 0;
  for (let index = 0; index < 4; index++) {
    direction(corner, index & 1 ? rect[1] : rect[0], index & 2 ? rect[3] : rect[2], t);
    chord = Math.max(chord, hypot3(corner[0] - axis[0], corner[1] - axis[1], corner[2] - axis[2]));
  }
  cull[base + 4] = axis[0];
  cull[base + 5] = axis[1];
  cull[base + 6] = axis[2];
  cull[base + 7] = PAGES.shadowConeHalfAngle(chord, halfFov);
}

/**
 * Box that reject opposes to a square of sun pages. An orthography has no apex: the region
 * cuts a sub-box of the extent box — its rectangle on the light plane, the whole depth along
 * the axis — and that box, in the frame of the last composed face, is the volume. The cull
 * shader reads a negative half-angle as "box": centre, then the three axes with their
 * half-extents, the depth one in `far`.
 */
export function writeBoxVolume(
  cull: Float32Array,
  base: number,
  boxCenter: readonly number[],
  halfSide: number,
  halfDepth: number,
  rect: Float64Array,
) {
  const u = PAGES.shadowBoxMid(rect[0], rect[1], halfSide),
    v = PAGES.shadowBoxMid(rect[2], rect[3], halfSide);
  for (let a = 0; a < 3; a++) {
    cull[base + a] = PAGES.shadowAlong(
      PAGES.shadowAlong(boxCenter[a], faceBasis[a], u),
      faceBasis[3 + a],
      v,
    );
    cull[base + 4 + a] = faceBasis[6 + a];
    cull[base + 8 + a] = faceBasis[a];
    cull[base + 12 + a] = faceBasis[3 + a];
  }
  cull[base + 3] = halfDepth;
  cull[base + 7] = -1;
  cull[base + 11] = PAGES.shadowBoxHalf(rect[0], rect[1], halfSide);
  cull[base + 15] = PAGES.shadowBoxHalf(rect[2], rect[3], halfSide);
}

/** Normalised rectangle of a page region in its face: `y` goes down in the draw frame. */
export function regionRect(
  out: Float64Array,
  rows: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
) {
  out[0] = PAGES.shadowRegionLow(rows, x0);
  out[1] = PAGES.shadowRegionHigh(rows, x1);
  out[2] = -PAGES.shadowRegionHigh(rows, y1);
  out[3] = -PAGES.shadowRegionLow(rows, y0);
  return out;
}
