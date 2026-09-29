import { LIGHT_KIND, type SceneLight } from '../light/contracts.ts';
import { boxPointDistance } from '../../math/primitives/box.ts';
import { writeFace } from './faces.ts';
import { LAMP_MIPS, LAMP_SIDE, SHADOW_PAGE, lampEntry, lampFacesOf } from './virtual.ts';

/** How one light reads a receiver box (`demand.ts`): whether it reaches it, the levels its
 *  pixels read there — a lamp's mips, a sun's clipmap levels — into `out`, a page's least world
 *  side at a level, and the pages a level reads, each handed to `mark`. */
export interface DemandLight {
  reaches(box: Float64Array, o: number): boolean;
  levels(box: Float64Array, o: number, fine: number, coarse: number, out: Int32Array): void;
  pageSide(box: Float64Array, o: number, level: number): number;
  mark(box: Float64Array, o: number, level: number, margin: number): void;
}

/** Farthest corner of the box from `(x, y, z)`. */
export function boxFarthest(box: ArrayLike<number>, o: number, x: number, y: number, z: number) {
  const dx = Math.max(x - box[o], box[o + 3] - x),
    dy = Math.max(y - box[o + 1], box[o + 4] - y),
    dz = Math.max(z - box[o + 2], box[o + 5] - z);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** `box` grown by `by` on every side, into `out`. */
export function growBox(box: Float64Array, o: number, by: number, out: Float64Array) {
  for (let k = 0; k < 3; k++) {
    out[k] = box[o + k] - by;
    out[k + 3] = box[o + 3 + k] + by;
  }
  return out;
}

const matrices = new Float32Array(6 * 16),
  grown = new Float64Array(6),
  /** Least and most of the rows `x`, `y`, `w` of a face's clip matrix over the grown box. */
  spans = new Float64Array(6);

/** Least and most of row `r` of the clip matrix at `m` over the grown box, into `spans[at]`. */
function rowSpan(m: number, r: number, at: number) {
  let lo = matrices[m + r + 12],
    hi = lo;
  for (let k = 0; k < 3; k++) {
    const c = matrices[m + r + 4 * k],
      a = c * grown[k],
      b = c * grown[k + 3];
    lo += Math.min(a, b);
    hi += Math.max(a, b);
  }
  spans[at] = lo;
  spans[at + 1] = hi;
}

const clampPage = (value: number, pages: number) =>
  Math.min(pages - 1, Math.max(0, Math.floor(value)));
const mipOf = (ratio: number) =>
  Math.min(LAMP_MIPS - 1, Math.max(0, Math.floor(Math.log2(Math.max(ratio, 1)))));

let px = 0,
  py = 0,
  pz = 0,
  range = 0,
  faces = 1,
  base = 0,
  tanHalf = 0,
  marked: (entry: number) => void = () => {};
/** World texel of the finest mip at distance `d` (the shading's `texel0`). */
const texelAt = (d: number) => (2 * tanHalf * d) / (LAMP_SIDE * SHADOW_PAGE);
const nearest = (box: Float64Array, o: number) =>
  Math.max(boxPointDistance(box, o, px, py, pz), 1e-9);

/**
 * A lamp as its shading reads it (`lampShadowFactor`): the mip whose texel at the point's
 * distance is at most the pixel's footprint, then the face its point lies in, then the page its
 * projection lands on. Over a box, each is taken as the interval the box spans: the mips between
 * the least footprint over the largest texel and the most over the smallest, and, on every face
 * the box reaches, the pages its projection covers — `x / w` over the box lies between the
 * quotients of the bounds of `x` and `w`. A box across a face's plane reads the whole face; its
 * mips there reach the lamp's coarsest, whose texels the distance zero shrinks to nothing.
 * One object, aimed at each lamp in turn: a frame allocates nothing.
 */
export const lampDemand: DemandLight & {
  aim(light: SceneLight, first: number, mark: (entry: number) => void): DemandLight;
} = {
  aim(light, first, mark) {
    [px, py, pz] = light.position!;
    range = light.range!;
    faces = lampFacesOf(LIGHT_KIND[light.kind]);
    base = first;
    marked = mark;
    for (let face = 0; face < faces; face++)
      tanHalf = Math.tan(writeFace(matrices, face * 16, null, 0, light, face).halfFov);
    return lampDemand;
  },
  reaches: (box, o) => boxPointDistance(box, o, px, py, pz) <= range,
  levels(box, o, fine, coarse, out) {
    out[0] = mipOf(fine / texelAt(boxFarthest(box, o, px, py, pz)));
    out[1] = mipOf(coarse / texelAt(nearest(box, o)));
  },
  pageSide: (box, o, mip) => texelAt(nearest(box, o)) * 2 ** mip * SHADOW_PAGE,
  mark(box, o, mip, margin) {
    growBox(box, o, margin * texelAt(boxFarthest(box, o, px, py, pz)) * 2 ** mip, grown);
    const pages = LAMP_SIDE >> mip;
    for (let face = 0, m = 0; face < faces; face++, m += 16) {
      rowSpan(m, 3, 4);
      if (spans[5] <= 0) continue;
      let u0 = -Infinity,
        u1 = Infinity,
        v0 = -Infinity,
        v1 = Infinity;
      if (spans[4] > 0) {
        rowSpan(m, 0, 0);
        rowSpan(m, 1, 2);
        u0 = Math.min(spans[0] / spans[4], spans[0] / spans[5]);
        u1 = Math.max(spans[1] / spans[4], spans[1] / spans[5]);
        v0 = Math.min(spans[2] / spans[4], spans[2] / spans[5]);
        v1 = Math.max(spans[3] / spans[4], spans[3] / spans[5]);
      }
      if (u1 < -1 || u0 > 1 || v1 < -1 || v0 > 1) continue;
      // `t = (ndc.x / 2 + 1/2, 1/2 − ndc.y / 2) · side`: the rows of pages run down the face.
      const x0 = clampPage((u0 * 0.5 + 0.5) * pages, pages),
        x1 = clampPage((u1 * 0.5 + 0.5) * pages, pages),
        y0 = clampPage((0.5 - v1 * 0.5) * pages, pages),
        y1 = clampPage((0.5 - v0 * 0.5) * pages, pages);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) marked(base + lampEntry(face, mip, x, y));
    }
  },
};
