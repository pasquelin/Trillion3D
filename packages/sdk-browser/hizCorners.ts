import { boxCornersInto } from '../sdk-core/src/index.ts';
import type { HizPage } from './hizTypes.ts';
import type { MatrixElements } from './matrixElements.ts';

export const HIZ_BOUNDS_VALUES = 6;

/** Doubles one box occupies in the world-corner layout: eight corners of three coordinates. */
const BOX_CORNER_VALUES = 24;
/** Screen AABB of eight world-space corners. Term for term the arithmetic of the one-shot path. */
export function projectCornersInto(
  corners: Float64Array,
  from: number,
  viewElements: ArrayLike<number>,
  viewProjElements: ArrayLike<number>,
  near: number,
  width: number,
  height: number,
  into: Float64Array,
  base: number,
) {
  let lowX = Infinity,
    lowY = Infinity,
    highX = -Infinity,
    highY = -Infinity,
    // In reverse-Z, the NEAREST corner is the one whose depth is the GREATEST: the bound the
    // occlusion test compares is therefore a maximum.
    nearestZ = -Infinity,
    clipsNear = false,
    projected = 0;
  const v = viewElements,
    e = viewProjElements;
  // An affine view — fourth row (0,0,0,1) — yields a denominator of exactly 1 for a finite
  // corner: the dot product is then no longer computed, and `viewZ * 1` was already `viewZ`.
  const affine = v[3] === 0 && v[7] === 0 && v[11] === 0 && v[15] === 1;
  // A perspective projection has fourth row (0,0,-1,0), of which `multiplyMatrices` makes
  // exactly the opposite of the view's third row: `cw` is then `-viewZ` to the bit — negation
  // is exact and `(-a) + (-b)` equals `-(a + b)` —, one fewer dot product per corner. Any
  // projection, orthographic or oblique, falls back on the product.
  const mirrored = e[3] === -v[2] && e[7] === -v[6] && e[11] === -v[10] && e[15] === -v[14];
  for (let i = 0; i < 8; i++) {
    const at = from + i * 3,
      x = corners[at],
      y = corners[at + 1],
      z = corners[at + 2];
    const viewZ = v[2] * x + v[6] * y + v[10] * z + v[14];
    const vd = affine ? 1 : v[3] * x + v[7] * y + v[11] * z + v[15];
    if (-(vd === 1 ? viewZ : viewZ * (1 / vd)) <= near) {
      // The result of a box that clips the near plane no longer reads any corner: nothing to project.
      clipsNear = true;
      break;
    }
    const cw = mirrored ? -viewZ : e[3] * x + e[7] * y + e[11] * z + e[15];
    if (cw <= 0 || !Number.isFinite(cw)) {
      clipsNear = true;
      break;
    }
    const ndcX = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw,
      ndcY = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw,
      ndcZ = (e[2] * x + e[6] * y + e[10] * z + e[14]) / cw;
    if (ndcX < lowX) lowX = ndcX;
    if (ndcX > highX) highX = ndcX;
    if (ndcY < lowY) lowY = ndcY;
    if (ndcY > highY) highY = ndcY;
    if (ndcZ > nearestZ) nearestZ = ndcZ;
    projected++;
  }
  if (!projected || clipsNear) {
    into[base] = 0;
    into[base + 1] = 0;
    into[base + 2] = 0;
    into[base + 3] = 0;
    into[base + 4] = 0;
    into[base + 5] = 1;
    return;
  }
  // The NDC-to-screen passage is monotonic coordinate by coordinate — increasing in x,
  // decreasing in y: the extremum of the image is the image of the extremum, to the bit. The
  // four conversions happen once per box instead of twenty-four. Depth itself is already in
  // `[0, 1]`: the engine projection never leaves it otherwise (`depthConvention.ts`).
  into[base] = Math.floor((lowX * 0.5 + 0.5) * width);
  into[base + 1] = Math.floor((1 - (highY * 0.5 + 0.5)) * height);
  into[base + 2] = Math.ceil((highX * 0.5 + 0.5) * width);
  into[base + 3] = Math.ceil((1 - (lowY * 0.5 + 0.5)) * height);
  into[base + 4] = nearestZ;
  into[base + 5] = 0;
}
const cornerScratch = new Float64Array(BOX_CORNER_VALUES);
/**
 * Conservative screen AABB of one box into `into` at `base`. min/max are inclusive integer samples
 * (fillIds last pixel is ceil(max)). Near-plane crossings never reject. The caller passes the view
 * and view-projection elements, so a batch builds them once instead of once per box; the arithmetic
 * is `boxCornersInto` (sdk-core) for both, so the flat and object forms agree bit for bit.
 */
export function projectBoxInto(
  min: readonly number[],
  max: readonly number[],
  world: MatrixElements,
  viewElements: ArrayLike<number>,
  viewProjElements: ArrayLike<number>,
  near: number,
  width: number,
  height: number,
  into: Float64Array,
  base: number,
) {
  boxCornersInto(cornerScratch, 0, min[0], min[1], min[2], max[0], max[1], max[2], world.elements);
  projectCornersInto(
    cornerScratch,
    0,
    viewElements,
    viewProjElements,
    near,
    width,
    height,
    into,
    base,
  );
}
/**
 * World-space corners kept per page from one image to the next. A corner changes only when the page's
 * world matrix does, and `epoch` is what names that: an image then pays the clip transform alone, not
 * the world transform of twenty thousand boxes it has already computed. The cached doubles are exactly
 * those the one-shot path computes, so the rectangles stay bit for bit the same.
 */
export function createBoxCorners(pageCount: number) {
  const corners = new Float64Array(Math.max(1, pageCount) * BOX_CORNER_VALUES),
    epoch = new Int32Array(Math.max(1, pageCount));
  return {
    corners,
    epoch,
    /** Offset of `pageIndex`'s corners, recomputed when its epoch no longer matches. */
    at(pageIndex: number, page: HizPage, value: number) {
      const base = pageIndex * BOX_CORNER_VALUES;
      if (epoch[pageIndex] !== value) {
        const { min, max } = page;
        boxCornersInto(
          corners,
          base,
          min[0],
          min[1],
          min[2],
          max[0],
          max[1],
          max[2],
          page.matrix.elements,
        );
        epoch[pageIndex] = value;
      }
      return base;
    },
  };
}
export type BoxCorners = ReturnType<typeof createBoxCorners>;
