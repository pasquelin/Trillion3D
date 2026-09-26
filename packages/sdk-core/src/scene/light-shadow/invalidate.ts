import { boxEmpty, boxUnion } from '../../math/primitives/box.ts';
import { LIGHT_KIND, type SceneLight } from '../light/contracts.ts';
import type { createShadowChanges } from './changes.ts';
import type { createShadowCounts } from './counts.ts';
import { createPageRects } from './pageRects.ts';
import { STALE_DYNAMIC, STALE_FULL, type ShadowPool } from './pool.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';
import {
  LAMP_MIPS,
  PAGE_INDEX_MASK,
  PAGE_MAPPED,
  SUN_LEVELS,
  SUN_WINDOW,
  lampEntry,
  lampFacesOf,
  ringOf,
  sunEntry,
} from './virtual.ts';

type Changes = ReturnType<typeof createShadowChanges>;
type Counts = ReturnType<typeof createShadowCounts>;

/** The position of a light that has none, the sun: its range bounds nothing. */
const ORIGIN = [0, 0, 0] as const;

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
 *   pages covered, never the pool. The boxes covering more pages than the pool holds join one,
 *   which scans the pool once: never more than the pool. A static caster that moved makes the
 *   static layer of those pages wrong: they are read no more until redrawn. An object already
 *   moving stales only their moving casters: the static layer under them holds, and they stay
 *   read. With per-page invalidation off, every page of each light the box touches.
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
  const { rects, sunRects, lampFaces, lampRects } = createPageRects();
  /** The union of a light's boxes that each cover more pages than the pool: scanned once. */
  const large = new Float64Array(6),
    largeMin = large.subarray(0, 3),
    largeMax = large.subarray(3, 6);
  let nowMs = 0,
    frame = 0;
  const mark = (page: number, level: number, wrong: boolean) => {
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
  /** Every page of `slice`, or, `covered`, those the rectangles of its `views` hold. */
  const scan = (
    slice: number,
    sunLight: boolean,
    views: number,
    covered: boolean,
    level: number,
    wrong: boolean,
  ) => {
    counts.visitedPages += pool.pages;
    for (let page = 0; page < pool.pages; page++) {
      if (pool.owner[page] < 0 || pool.slice[page] !== slice) continue;
      const key = pool.view[page],
        view = sunLight ? key - sun.finest[slice] : (key >> 4) * LAMP_MIPS + (key & 15);
      if (!covered || within(views, view, pool.x[page], pool.y[page])) mark(page, level, wrong);
    }
  };
  /** The table entries the rectangles hold: a mapped one names its page. */
  const walk = (slice: number, sunLight: boolean, views: number, level: number, wrong: boolean) => {
    const base = table.baseOf(slice);
    for (let view = 0; view < views; view++) {
      const r = view * 4,
        face = Math.floor(view / LAMP_MIPS),
        mip = view % LAMP_MIPS,
        sunLevel = sun.finest[slice] + view;
      for (let y = rects[r + 2]; y <= rects[r + 3]; y++) {
        // A sun row is a ring of the extent, a lamp row a run of its mip.
        const row = base + (sunLight ? sunEntry(sunLevel, 0, y) : lampEntry(face, mip, 0, y));
        for (let x = rects[r]; x <= rects[r + 1]; x++) {
          counts.visitedPages++;
          const word = table.words[row + (sunLight ? ringOf(x, SUN_WINDOW) : x)];
          if (word & PAGE_MAPPED) mark(word & PAGE_INDEX_MASK, level, wrong);
        }
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
      views = sunLight ? SUN_LEVELS : lampFacesOf(LIGHT_KIND[light.kind]) * LAMP_MIPS,
      range = sunLight ? 0 : (light.range ?? 0),
      [x, y, z] = light.position ?? ORIGIN;
    nowMs = now;
    frame = at;
    if (whole) {
      scan(slice, sunLight, views, false, STALE_FULL, true);
      return;
    }
    if (!sunLight && byPage && changes.count) lampFaces(light);
    // Per-page invalidation off: every box that touches stales the same pages, so one scan at
    // the strongest level, withdrawing when any box is wrong, does what one scan a box would.
    // Boxes that each cover more than the pool join one box, scanned once at the end: the light's
    // work is the pages its other boxes cover, and one pool at most.
    let every = 0,
      everyWrong = false,
      largeLevel = 0,
      largeWrong = false;
    boxEmpty(large, 0);
    for (let box = 0; box < changes.count; box++) {
      if (!changes.touches(box, x, y, z, range)) continue;
      const moved = changes.read(box),
        level = moved.moving ? STALE_DYNAMIC : STALE_FULL,
        wrong = !moved.detail && !moved.moving;
      if (!byPage) {
        every = Math.max(every, level);
        everyWrong ||= wrong;
        continue;
      }
      const covered = sunLight
        ? sunRects(sun, slice, moved.min, moved.max)
        : lampRects(moved.min, moved.max);
      if (covered <= pool.pages) {
        walk(slice, sunLight, views, level, wrong);
        continue;
      }
      const { min, max } = moved;
      boxUnion(large, 0, min[0], min[1], min[2], max[0], max[1], max[2]);
      largeLevel = Math.max(largeLevel, level);
      largeWrong ||= wrong;
    }
    if (every) scan(slice, sunLight, views, false, every, everyWrong);
    if (!largeLevel) return;
    if (sunLight) sunRects(sun, slice, largeMin, largeMax);
    else lampRects(largeMin, largeMax);
    scan(slice, sunLight, views, true, largeLevel, largeWrong);
  };
}
