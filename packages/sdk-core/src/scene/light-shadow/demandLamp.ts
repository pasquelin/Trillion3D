import { LIGHT_KIND, type SceneLight } from '../light/contracts.ts';
import { boxPointDistance } from '../../math/primitives/box.ts';
import { boxPointFarthest } from '../../math/primitives/boxReach.ts';
import { writeFace } from './faces.ts';
import { LAMP_MIPS, LAMP_SIDE, SHADOW_PAGE, lampEntry, lampFacesOf } from './virtual.ts';

/** How one light reads a receiver box (`demand.ts`): whether it reaches it, the levels its
 *  pixels read there — a lamp's mips, a sun's clipmap levels — into `out`, a page's least world
 *  side at a level, and the pages a level reads, each handed to `mark`. */
export interface DemandLight {
  reaches(box: ArrayLike<number>, o: number): boolean;
  levels(box: Float64Array, o: number, fine: number, coarse: number, out: Int32Array): void;
  pageSide(box: Float64Array, o: number, level: number): number;
  mark(box: Float64Array, o: number, level: number, margin: number): void;
}

/** `box` grown by `by` on every side, into `out`. */
export function growBox(box: Float64Array, o: number, by: number, out: Float64Array) {
  for (let k = 0; k < 3; k++) {
    out[k] = box[o + k] - by;
    out[k + 3] = box[o + 3 + k] + by;
  }
  return out;
}

const clampPage = (value: number, pages: number) =>
  Math.min(pages - 1, Math.max(0, Math.floor(value)));
const mipOf = (ratio: number) =>
  Math.min(LAMP_MIPS - 1, Math.max(0, Math.floor(Math.log2(Math.max(ratio, 1)))));

/**
 * A lamp as its shading reads it (`lampShadowFactor`): the mip whose texel at the point's
 * distance is at most the pixel's footprint, then the face its point lies in, then the page its
 * projection lands on. Over a box, each is taken as the interval the box spans: the mips between
 * the least footprint over the largest texel and the most over the smallest, and, on every face
 * the box reaches, the pages its projection covers — `x / w` over the box lies between the
 * quotients of the bounds of `x` and `w`. A box across a face's plane reads the whole face; its
 * mips there reach the lamp's coarsest, whose texels the distance zero shrinks to nothing.
 * One reader, aimed at each lamp in turn: a frame allocates nothing.
 */
export function createLampDemand() {
  const matrices = new Float32Array(6 * 16),
    position = new Float64Array(3),
    grown = new Float64Array(6),
    /** Least and most of the rows `x`, `y`, `w` of a face's clip matrix over the grown box. */
    spans = new Float64Array(6);
  let range = 0,
    faces = 1,
    base = 0,
    tanHalf = 0,
    marked: (entry: number) => void = () => {};
  /** Least and most of row `r` of the clip matrix at `m` over the grown box, into `spans[at]`. */
  const rowSpan = (m: number, r: number, at: number) => {
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
  };
  /** Least `|c|` over the span at `spans[at]`. */
  const leastAbs = (at: number) => Math.max(spans[at], -spans[at + 1], 0);
  /**
   * Whether the grown box reaches point face `face` — its axis `face >> 1`, positive for an even
   * face (`POINT_FACE_AXES`) —: a point read there lies farther along that axis than along the
   * other two. The test the clip rows make, on the box's own axes, before any is composed.
   */
  const pointFaceReached = (face: number) => {
    const k = face >> 1,
      far = face & 1 ? position[k] - grown[k] : grown[k + 3] - position[k];
    if (far <= 0) return false;
    for (let a = 1; a < 3; a++) {
      const j = (k + a) % 3;
      if (far < Math.max(grown[j] - position[j], position[j] - grown[j + 3], 0)) return false;
    }
    return true;
  };
  /** World texel of the finest mip at distance `d` (the shading's `texel0`). */
  const texelAt = (d: number) => (2 * tanHalf * d) / (LAMP_SIDE * SHADOW_PAGE);
  const nearest = (box: ArrayLike<number>, o: number) =>
    Math.max(boxPointDistance(box, o, position[0], position[1], position[2]), 1e-9);
  const farthest = (box: ArrayLike<number>, o: number) =>
    boxPointFarthest(box, o, position[0], position[1], position[2]);
  const reader: DemandLight & {
    aim(light: SceneLight, first: number, mark: (entry: number) => void): DemandLight;
  } = {
    aim(light, first, mark) {
      position.set(light.position!);
      range = light.range!;
      faces = lampFacesOf(LIGHT_KIND[light.kind]);
      base = first;
      marked = mark;
      for (let face = 0; face < faces; face++)
        tanHalf = Math.tan(writeFace(matrices, face * 16, null, 0, light, face).halfFov);
      return reader;
    },
    reaches: (box, o) => boxPointDistance(box, o, position[0], position[1], position[2]) <= range,
    levels(box, o, fine, coarse, out) {
      out[0] = mipOf(fine / texelAt(farthest(box, o)));
      out[1] = mipOf(coarse / texelAt(nearest(box, o)));
    },
    pageSide: (box, o, mip) => texelAt(nearest(box, o)) * 2 ** mip * SHADOW_PAGE,
    mark(box, o, mip, margin) {
      growBox(box, o, margin * texelAt(farthest(box, o)) * 2 ** mip, grown);
      const pages = LAMP_SIDE >> mip;
      for (let face = 0, m = 0; face < faces; face++, m += 16) {
        if (faces > 1 && !pointFaceReached(face)) continue;
        rowSpan(m, 0, 0);
        rowSpan(m, 1, 2);
        rowSpan(m, 3, 4);
        // A point the face reads projects within it, `|x|, |y| ≤ w`: its `w` is at least the
        // box's least `|x|` and `|y|`, so a box across the face's plane is bounded by what it holds.
        const w0 = Math.max(spans[4], leastAbs(0), leastAbs(2)),
          w1 = spans[5];
        if (w1 <= 0 || w1 < w0) continue;
        let u0 = -1,
          u1 = 1,
          v0 = -1,
          v1 = 1;
        if (w0 > 0) {
          u0 = Math.min(spans[0] / w0, spans[0] / w1);
          u1 = Math.max(spans[1] / w0, spans[1] / w1);
          v0 = Math.min(spans[2] / w0, spans[2] / w1);
          v1 = Math.max(spans[3] / w0, spans[3] / w1);
        }
        if (u1 < -1 || u0 > 1 || v1 < -1 || v0 > 1) continue;
        // `t = (ndc.x / 2 + 1/2, 1/2 − ndc.y / 2) · side`: the rows of pages run down the face.
        const x0 = clampPage((u0 * 0.5 + 0.5) * pages, pages),
          x1 = clampPage((u1 * 0.5 + 0.5) * pages, pages),
          y0 = clampPage((0.5 - v1 * 0.5) * pages, pages),
          y1 = clampPage((0.5 - v0 * 0.5) * pages, pages);
        for (let y = y0; y <= y1; y++) {
          const row = base + lampEntry(face, mip, 0, y);
          for (let x = x0; x <= x1; x++) marked(row + x);
        }
      }
    },
  };
  return reader;
}
