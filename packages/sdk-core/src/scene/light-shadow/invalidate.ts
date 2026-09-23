import type { SceneLight } from '../light/contracts.ts';
import type { createShadowChanges } from './changes.ts';
import { writeFace } from './faces.ts';
import type { ShadowPool } from './pool.ts';
import type { SunLevels } from './sunLevels.ts';
import { POOL_PAGES, lampPagesAt, sunPageMetres } from './virtual.ts';
import { STALE_DYNAMIC, STALE_FULL } from './pool.ts';

type Changes = ReturnType<typeof createShadowChanges>;

/** Face matrices of the lamp being invalidated, and the rectangle a box covers on each face:
 *  `u0, u1, v0, v1` in normalised coordinates, or `NaN` when a corner lies behind the light. */
const matrices = new Float32Array(6 * 16);
const rects = new Float64Array(6 * 4);

/** Writes the normalised rectangle box `min..max` covers on `face`, or NaN when not flat. */
function faceRect(face: number, min: ArrayLike<number>, max: ArrayLike<number>) {
  const b = face * 16,
    r = face * 4;
  rects[r] = rects[r + 2] = Infinity;
  rects[r + 1] = rects[r + 3] = -Infinity;
  for (let corner = 0; corner < 8; corner++) {
    const x = corner & 1 ? max[0] : min[0],
      y = corner & 2 ? max[1] : min[1],
      z = corner & 4 ? max[2] : min[2];
    const m = matrices;
    const w = m[b + 3] * x + m[b + 7] * y + m[b + 11] * z + m[b + 15];
    if (w <= 1e-6) {
      rects[r] = NaN;
      return;
    }
    const u = (m[b] * x + m[b + 4] * y + m[b + 8] * z + m[b + 12]) / w,
      v = (m[b + 1] * x + m[b + 5] * y + m[b + 9] * z + m[b + 13]) / w;
    rects[r] = Math.min(rects[r], u);
    rects[r + 1] = Math.max(rects[r + 1], u);
    rects[r + 2] = Math.min(rects[r + 2], v);
    rects[r + 3] = Math.max(rects[r + 3], v);
  }
}

/** True when lamp page `(x, y)` of `mip` on `face` meets that face's rectangle. */
function lampPageMeets(face: number, mip: number, x: number, y: number) {
  const r = face * 4;
  if (Number.isNaN(rects[r])) return true;
  const pages = lampPagesAt(mip);
  // `y` grows downward in the page grid, upward in normalised space.
  const u0 = (2 * x) / pages - 1,
    v1 = 1 - (2 * y) / pages;
  return (
    rects[r + 1] >= u0 &&
    rects[r] <= u0 + 2 / pages &&
    rects[r + 3] >= v1 - 2 / pages &&
    rects[r + 2] <= v1
  );
}

/** Writes the light-plane rectangle of a world box under the sun of `slice` into `rects[0..4)`. */
function sunRect(sun: SunLevels, slice: number, min: ArrayLike<number>, max: ArrayLike<number>) {
  const f = slice * 9,
    frame = sun.frame;
  rects[0] = rects[2] = Infinity;
  rects[1] = rects[3] = -Infinity;
  for (let corner = 0; corner < 8; corner++) {
    const x = corner & 1 ? max[0] : min[0],
      y = corner & 2 ? max[1] : min[1],
      z = corner & 4 ? max[2] : min[2];
    const u = frame[f] * x + frame[f + 1] * y + frame[f + 2] * z,
      v = frame[f + 3] * x + frame[f + 4] * y + frame[f + 5] * z;
    rects[0] = Math.min(rects[0], u);
    rects[1] = Math.max(rects[1], u);
    rects[2] = Math.min(rects[2], v);
    rects[3] = Math.max(rects[3], v);
  }
}

/** True when sun page `(level, ax, ay)` — rows down the `up` axis — meets `rects[0..4)`. */
function sunPageMeets(level: number, ax: number, ay: number) {
  const page = sunPageMetres(level);
  return (
    rects[1] >= ax * page &&
    rects[0] <= (ax + 1) * page &&
    -rects[2] >= ay * page &&
    -rects[3] <= (ay + 1) * page
  );
}

/**
 * What stales the mapped pages of a shadow light, and nothing more. Only mapped pages can be
 * stale: a page nobody reads has no content to keep, and is drawn whole when first asked for.
 *
 * - **The light moved, changed, or its clipmap changed projection** (`whole`): every page.
 * - **An object moved within its reach**: only the pages its projected box covers — the rest
 *   still describes the scene, since nothing else changed. An object already moving stales only
 *   their moving casters: the static layer under them holds. With per-page invalidation off,
 *   every page of each light the box touches, the rule from before per-page maps.
 *
 * Returns the pages staled.
 */
export function invalidateLightPages(
  pool: ShadowPool,
  sun: SunLevels,
  changes: Changes,
  light: SceneLight,
  slice: number,
  whole: boolean,
  byPage: boolean,
  nowMs: number,
  frame: number,
) {
  let staled = 0;
  const isSun = light.kind === 'directional',
    faces = light.kind === 'point' ? 6 : 1;
  const range = isSun ? 0 : (light.range ?? 0);
  const [x, y, z] = light.position ?? [0, 0, 0];
  if (!isSun && !whole && changes.count)
    for (let face = 0; face < faces; face++) writeFace(matrices, face * 16, null, 0, light, face);
  for (let box = 0; box < (whole ? 1 : changes.count); box++) {
    if (!whole && !changes.touches(box, x, y, z, range)) continue;
    const moved = whole || !byPage ? undefined : changes.read(box);
    if (moved && isSun) sunRect(sun, slice, moved.min, moved.max);
    if (moved && !isSun)
      for (let face = 0; face < faces; face++) faceRect(face, moved.min, moved.max);
    for (let page = 0; page < POOL_PAGES; page++) {
      if (pool.owner[page] < 0 || pool.slice[page] !== slice) continue;
      const key = pool.view[page];
      const meets =
        !moved ||
        (isSun
          ? sunPageMeets(key, pool.x[page], pool.y[page])
          : lampPageMeets(key >> 4, key & 15, pool.x[page], pool.y[page]));
      const level = moved?.moving ? STALE_DYNAMIC : STALE_FULL;
      if (meets && pool.stale(page, nowMs, frame, level)) staled++;
    }
  }
  return staled;
}
