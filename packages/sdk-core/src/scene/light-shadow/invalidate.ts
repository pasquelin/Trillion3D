import { LIGHT_KIND, POINT_FACES, type SceneLight } from '../light/contracts.ts';
import type { createShadowChanges } from './changes.ts';
import type { createShadowCounts } from './counts.ts';
import { writeFace } from './faces.ts';
import { sunBoxRect } from './math.ts';
import { STALE_DYNAMIC, STALE_FULL, type ShadowPool } from './pool.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';
import { LAMP_MIPS, PAGE_INDEX_MASK, PAGE_MAPPED, SUN_LEVELS, SUN_WINDOW } from './virtual.ts';
import { lampEntry, lampFacesOf, lampPagesAt, sunEntry, sunPageMetres } from './virtual.ts';

type Changes = ReturnType<typeof createShadowChanges>;
type Counts = ReturnType<typeof createShadowCounts>;

/** Light views of one light: a sun's clipmap levels, a lamp face at each mip. */
const VIEWS = Math.max(SUN_LEVELS, POINT_FACES * LAMP_MIPS);
/** The pages a box covers in each view, `x0, x1, y0, y1` inclusive: absolute pages of a sun
 *  level, pages of a lamp face's mip. Empty when `x0 > x1` or `y0 > y1`. */
const rects = new Float64Array(VIEWS * 4);
/** Face matrices of the lamp being invalidated; the box's light-plane or face rectangle; the box
 *  clipped to a point face's depth span. All allocated once. */
const matrices = new Float32Array(POINT_FACES * 16),
  plane = new Float64Array(4),
  low = new Float64Array(3),
  high = new Float64Array(3);

/** Writes view `view`'s rectangle; returns the pages it covers. */
function setRect(view: number, x0: number, x1: number, y0: number, y1: number) {
  const r = view * 4;
  rects[r] = x0;
  rects[r + 1] = x1;
  rects[r + 2] = y0;
  rects[r + 3] = y1;
  return x0 > x1 || y0 > y1 ? 0 : (x1 - x0 + 1) * (y1 - y0 + 1);
}

/** The pages of every clipmap level the box covers, within the level's extent: a page meets the
 *  box's light-plane rectangle, edges included. Returns the pages covered. */
function sunRects(sun: SunLevels, slice: number, min: ArrayLike<number>, max: ArrayLike<number>) {
  sunBoxRect(sun.frame, slice * 9, min, max, plane, 0);
  let covered = 0;
  for (let view = 0; view < SUN_LEVELS; view++) {
    const level = sun.finest[slice] + view,
      metres = sunPageMetres(level),
      ox = sun.originOf(slice, level, 0),
      oy = sun.originOf(slice, level, 1);
    covered += setRect(
      view,
      Math.max(ox, Math.ceil(plane[0] / metres) - 1),
      Math.min(ox + SUN_WINDOW - 1, Math.floor(plane[1] / metres)),
      Math.max(oy, Math.ceil(plane[2] / metres) - 1),
      Math.min(oy + SUN_WINDOW - 1, Math.floor(plane[3] / metres)),
    );
  }
  return covered;
}

/**
 * The pages of every mip of `face` the box `low..high` covers. A corner at or behind the light's
 * plane leaves the rectangle unbounded: the whole face. A point face never meets one — its box was
 * clipped to its depth span —, a spot may.
 */
function faceRects(face: number) {
  const b = face * 16,
    m = matrices;
  plane[0] = plane[2] = Infinity;
  plane[1] = plane[3] = -Infinity;
  const empty = low[0] > high[0] || low[1] > high[1] || low[2] > high[2];
  for (let corner = 0; corner < 8 && !empty; corner++) {
    const x = corner & 1 ? high[0] : low[0],
      y = corner & 2 ? high[1] : low[1],
      z = corner & 4 ? high[2] : low[2];
    const w = m[b + 3] * x + m[b + 7] * y + m[b + 11] * z + m[b + 15];
    if (w <= 1e-6) {
      plane[0] = plane[2] = -Infinity;
      plane[1] = plane[3] = Infinity;
      break;
    }
    const u = (m[b] * x + m[b + 4] * y + m[b + 8] * z + m[b + 12]) / w,
      v = (m[b + 1] * x + m[b + 5] * y + m[b + 9] * z + m[b + 13]) / w;
    plane[0] = Math.min(plane[0], u);
    plane[1] = Math.max(plane[1], u);
    plane[2] = Math.min(plane[2], v);
    plane[3] = Math.max(plane[3], v);
  }
  let covered = 0;
  for (let mip = 0; mip < LAMP_MIPS; mip++) {
    // Columns grow with u, rows downward: page `(x, y)` spans `u ∈ [2x/n − 1, 2(x+1)/n − 1]`.
    const n = lampPagesAt(mip),
      half = n / 2;
    covered += setRect(
      face * LAMP_MIPS + mip,
      Math.max(0, Math.ceil((plane[0] + 1) * half) - 1),
      Math.min(n - 1, Math.floor((plane[1] + 1) * half)),
      Math.max(0, Math.ceil((1 - plane[3]) * half) - 1),
      Math.min(n - 1, Math.floor((1 - plane[2]) * half)),
    );
  }
  return covered;
}

/** The pages of every face and mip of a lamp the box covers. A point face is axis-aligned: the
 *  box is clipped to its depth span `[near, far]` along the axis, where alone a caster writes. */
function lampRects(
  light: SceneLight,
  faces: number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
) {
  let covered = 0;
  for (let face = 0; face < faces; face++) {
    const { near, far } = writeFace(matrices, face * 16, null, 0, light, face);
    low.set(min);
    high.set(max);
    if (faces === POINT_FACES) {
      const axis = face >> 1,
        at = light.position![axis],
        sign = face & 1 ? -1 : 1;
      low[axis] = Math.max(low[axis], sign > 0 ? at + near : at - far);
      high[axis] = Math.min(high[axis], sign > 0 ? at + far : at - near);
    }
    covered += faceRects(face);
  }
  return covered;
}

/**
 * What stales the mapped pages of a shadow light, and nothing more — the reference invalidation
 * of virtual shadow maps. Only mapped pages can be stale: a page nobody reads has no content to
 * keep, and is drawn whole when first asked for.
 *
 * - **The light moved, changed shape, or its clipmap changed projection** (`whole`): every page,
 *   the floor too, and none is read until redrawn (`pool.withdraw`) — its depth was drawn under a
 *   projection the record no longer holds. The floor is drawn first (`admit.ts`); a face whose
 *   floor the frame cannot draw reads no shadow.
 * - **An object moved within its reach**: in each light view — a sun level, a lamp face at a
 *   mip —, the rectangle of pages its box covers, read through the page table: the work is the
 *   pages covered, never the pool. A box covering more pages than the pool holds scans the pool
 *   instead: never more than the pool. A static caster that moved makes the static layer of those
 *   pages wrong: they are read no more until redrawn. An object already moving stales only their
 *   moving casters: the static layer under them holds, and they stay read. With per-page
 *   invalidation off, every page of each light the box touches.
 * - **The representation changed** (the released union of `changes.ts`): the same pages, stale for
 *   detail only — their depth is coarser than the cut, not wrong, and stays read until redrawn.
 *
 * Adds the pages staled and the pages visited to `counts`.
 */
export function createPageInvalidation(
  pool: ShadowPool,
  table: ShadowTable,
  sun: SunLevels,
  changes: Changes,
  counts: Counts,
) {
  let level = STALE_FULL,
    wrong = true,
    nowMs = 0,
    frame = 0;
  const mark = (page: number) => {
    if (pool.stale(page, nowMs, frame, level)) counts.invalidatedPages++;
    if (wrong) pool.withdraw(table, page);
  };
  const within = (views: number, view: number, x: number, y: number) =>
    view >= 0 &&
    view < views &&
    x >= rects[view * 4] &&
    x <= rects[view * 4 + 1] &&
    y >= rects[view * 4 + 2] &&
    y <= rects[view * 4 + 3];
  /** Every page of `slice`, or those the rectangles of its `views` hold. */
  const scan = (slice: number, sunLight: boolean, views: number) => {
    for (let page = 0; page < pool.pages; page++) {
      if (pool.owner[page] < 0 || pool.slice[page] !== slice) continue;
      counts.visitedPages++;
      const key = pool.view[page],
        view = sunLight ? key - sun.finest[slice] : (key >> 4) * LAMP_MIPS + (key & 15);
      if (!views || within(views, view, pool.x[page], pool.y[page])) mark(page);
    }
  };
  /** The table entries the rectangles hold: a mapped one names its page. */
  const walk = (slice: number, sunLight: boolean, views: number) => {
    const base = table.baseOf(slice);
    for (let view = 0; view < views; view++) {
      const r = view * 4;
      for (let y = rects[r + 2]; y <= rects[r + 3]; y++)
        for (let x = rects[r]; x <= rects[r + 1]; x++) {
          counts.visitedPages++;
          const word =
            table.words[
              base +
                (sunLight
                  ? sunEntry(sun.finest[slice] + view, x, y)
                  : lampEntry(Math.floor(view / LAMP_MIPS), view % LAMP_MIPS, x, y))
            ];
          if (word & PAGE_MAPPED) mark(word & PAGE_INDEX_MASK);
        }
    }
  };
  return (
    light: SceneLight,
    slice: number,
    whole: boolean,
    byPage: boolean,
    now: number,
    at: number,
  ) => {
    const sunLight = light.kind === 'directional',
      faces = lampFacesOf(LIGHT_KIND[light.kind]),
      views = sunLight ? SUN_LEVELS : faces * LAMP_MIPS,
      range = sunLight ? 0 : (light.range ?? 0);
    const [x, y, z] = light.position ?? [0, 0, 0];
    nowMs = now;
    frame = at;
    if (whole) {
      level = STALE_FULL;
      wrong = true;
      scan(slice, sunLight, 0);
      return;
    }
    for (let box = 0; box < changes.count; box++) {
      if (!changes.touches(box, x, y, z, range)) continue;
      const moved = changes.read(box);
      level = moved.moving ? STALE_DYNAMIC : STALE_FULL;
      wrong = !moved.detail && !moved.moving;
      if (!byPage) {
        scan(slice, sunLight, 0);
        continue;
      }
      const covered = sunLight
        ? sunRects(sun, slice, moved.min, moved.max)
        : lampRects(light, faces, moved.min, moved.max);
      if (covered > pool.pages) scan(slice, sunLight, views);
      else walk(slice, sunLight, views);
    }
  };
}
