import * as THREE from 'three';
import type { HizPage } from './hizTypes.ts';

export const HIZ_BOUNDS_VALUES = 6;

/** Doubles one box occupies in the world-corner layout: eight corners of three coordinates. */
const BOX_CORNER_VALUES = 24;
/** The eight world-space corners of a local box, in the order the screen projection reads them. */
function worldCornersInto(
  min: readonly number[],
  max: readonly number[],
  world: THREE.Matrix4,
  into: Float64Array,
  base: number,
) {
  const m = world.elements;
  for (let i = 0; i < 8; i++) {
    const lx = i & 1 ? max[0] : min[0],
      ly = i & 2 ? max[1] : min[1],
      lz = i & 4 ? max[2] : min[2];
    const mw = 1 / (m[3] * lx + m[7] * ly + m[11] * lz + m[15]);
    const at = base + i * 3;
    into[at] = (m[0] * lx + m[4] * ly + m[8] * lz + m[12]) * mw;
    into[at + 1] = (m[1] * lx + m[5] * ly + m[9] * lz + m[13]) * mw;
    into[at + 2] = (m[2] * lx + m[6] * ly + m[10] * lz + m[14]) * mw;
  }
}
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
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    nearest = Infinity,
    clipsNear = false,
    projected = 0;
  const v = viewElements,
    e = viewProjElements;
  for (let i = 0; i < 8; i++) {
    const at = from + i * 3,
      x = corners[at],
      y = corners[at + 1],
      z = corners[at + 2];
    // Une vue affine — la quatrième ligne vaut (0,0,0,1) — rend un dénominateur exactement 1 pour
    // un coin fini, et `viewZ * 1` est `viewZ` au bit près : la division est alors sautée, pas
    // remplacée. Un dénominateur quelconque, ou seulement inexact, retombe sur elle.
    const vd = v[3] * x + v[7] * y + v[11] * z + v[15];
    const vw = vd === 1 ? 1 : 1 / vd;
    if (-((v[2] * x + v[6] * y + v[10] * z + v[14]) * vw) <= near) {
      // Le résultat d'une boîte qui coupe le plan proche ne lit plus aucun coin : rien à projeter.
      clipsNear = true;
      break;
    }
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (cw <= 0 || !Number.isFinite(cw)) {
      clipsNear = true;
      break;
    }
    const ndcX = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw,
      ndcY = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw,
      ndcZ = (e[2] * x + e[6] * y + e[10] * z + e[14]) / cw;
    const sx = (ndcX * 0.5 + 0.5) * width,
      sy = (1 - (ndcY * 0.5 + 0.5)) * height,
      sz = ndcZ * 0.5 + 0.5;
    if (sx < minX) minX = sx;
    if (sy < minY) minY = sy;
    if (sx > maxX) maxX = sx;
    if (sy > maxY) maxY = sy;
    if (sz < nearest) nearest = sz;
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
  into[base] = Math.floor(minX);
  into[base + 1] = Math.floor(minY);
  into[base + 2] = Math.ceil(maxX);
  into[base + 3] = Math.ceil(maxY);
  into[base + 4] = nearest;
  into[base + 5] = 0;
}
const cornerScratch = new Float64Array(BOX_CORNER_VALUES);
/**
 * Conservative screen AABB of one box into `into` at `base`. min/max are inclusive integer samples
 * (fillIds last pixel is ceil(max)). Near-plane crossings never reject. The caller passes the view
 * and view-projection elements, so a batch builds them once instead of once per box; the arithmetic
 * is `Matrix4`/`Vector3.applyMatrix4` term for term, so the flat and object forms agree bit for bit.
 */
export function projectBoxInto(
  min: readonly number[],
  max: readonly number[],
  world: THREE.Matrix4,
  viewElements: ArrayLike<number>,
  viewProjElements: ArrayLike<number>,
  near: number,
  width: number,
  height: number,
  into: Float64Array,
  base: number,
) {
  worldCornersInto(min, max, world, cornerScratch, 0);
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
        worldCornersInto(page.min, page.max, page.matrix, corners, base);
        epoch[pageIndex] = value;
      }
      return base;
    },
  };
}
export type BoxCorners = ReturnType<typeof createBoxCorners>;
