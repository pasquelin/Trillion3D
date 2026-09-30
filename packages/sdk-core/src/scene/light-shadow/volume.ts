import { CONE } from './coneModel.ts';
import { faceBasis } from './math.ts';
import { PAGES } from './pageModel.ts';

/**
 * Rectangle of a region, in normalised face coordinates: `u0, u1, v0, v1`. The whole
 * face is `−1, 1, −1, 1`, and the volume it produces is then exactly that from before this
 * batch: the cone circumscribed to the square, or the box of the whole square of sun pages.
 */
export const FULL_FACE = new Float64Array([-1, 1, -1, 1]);

/**
 * Cone that reject opposes to a region of a perspective face, from the last composed face
 * (`faceBasis`): the light at `position` as apex, out to `far`, and the page's cone
 * (`coneModel.ts`, the GPU's pages' too).
 */
export function writeConeVolume(
  cull: Float32Array,
  base: number,
  position: readonly number[],
  far: number,
  halfFov: number,
  rect: Float64Array,
) {
  const [u0, u1, v0, v1] = rect,
    r = [faceBasis[0], faceBasis[1], faceBasis[2]],
    u = [faceBasis[3], faceBasis[4], faceBasis[5]],
    f = [faceBasis[6], faceBasis[7], faceBasis[8]],
    t = Math.tan(halfFov),
    axis = CONE.shadowConeAxis(f, r, u, t, halfFov, u0, u1, v0, v1);
  for (let a = 0; a < 3; a++) {
    cull[base + a] = position[a];
    cull[base + 4 + a] = axis[a];
  }
  cull[base + 3] = far;
  cull[base + 7] = CONE.shadowConeSpread(f, r, u, t, halfFov, axis, u0, u1, v0, v1);
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
