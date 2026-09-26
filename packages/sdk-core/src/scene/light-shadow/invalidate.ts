import { boxEmpty, boxUnion } from '../../math/primitives/box.ts';
import { LIGHT_KIND, type SceneLight } from '../light/contracts.ts';
import type { createShadowChanges } from './changes.ts';
import type { createShadowCounts } from './counts.ts';
import { createPageRects } from './pageRects.ts';
import { STALE_DYNAMIC, STALE_FULL, type ShadowPool } from './pool.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';
import { LAMP_MIPS, PAGE_INDEX_MASK, PAGE_MAPPED, SUN_LEVELS, SUN_WINDOW } from './virtual.ts';
import { lampEntry, lampFacesOf, ringOf, sunEntry, tableEntriesOf } from './virtual.ts';

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
 *   pages covered, never the pool; a box covering more entries than the pool holds pages scans
 *   the pool once against its own rectangles instead. Either way it stales its own pages alone,
 *   never a neighbour's. A light examines at most as many pages as it has virtual pages
 *   (`tableEntriesOf`) — past that, its boxes can only cover its entries again —: the boxes
 *   beyond join one union per kind, static layer wrong or kept, each read by one pool scan. A
 *   static caster that moved makes the static layer of those pages wrong: they are read no more
 *   until redrawn. An object already moving stales only their moving casters: the static layer
 *   under them holds, and they stay read. With per-page invalidation off, every page of each
 *   light the box touches.
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
  /** The unions of a light's boxes past its budget, scanned once each: those whose static layer
   *  is wrong, and the others — a moving caster past the budget keeps the static layer read. */
  const restWrong = new Float64Array(6),
    restKept = new Float64Array(6),
    wrongMin = restWrong.subarray(0, 3),
    wrongMax = restWrong.subarray(3, 6),
    keptMin = restKept.subarray(0, 3),
    keptMax = restKept.subarray(3, 6);
  /** The light being invalidated — its slice, its kind, its views — and the frame's stamp. */
  let slice = 0,
    sunLight = false,
    views = 0,
    nowMs = 0,
    frame = 0;
  const mark = (page: number, level: number, wrong: boolean) => {
    if (pool.stale(page, nowMs, frame, level)) counts.invalidatedPages++;
    if (wrong) pool.withdraw(table, page);
  };
  const within = (view: number, x: number, y: number) =>
    view >= 0 &&
    view < views &&
    x >= rects[view * 4] &&
    x <= rects[view * 4 + 1] &&
    y >= rects[view * 4 + 2] &&
    y <= rects[view * 4 + 3];
  /** The rectangles of box `min..max` in each view of the light: returns the pages covered. */
  const project = (min: ArrayLike<number>, max: ArrayLike<number>) =>
    sunLight ? sunRects(sun, slice, min, max) : lampRects(min, max);
  /** Every page of the light, or, `covered`, those the rectangles hold: stale at `level`, and
   *  withdrawn when `wrong`. */
  const scan = (covered: boolean, level: number, wrong: boolean) => {
    counts.visitedPages += pool.pages;
    for (let page = 0; page < pool.pages; page++) {
      if (pool.owner[page] < 0 || pool.slice[page] !== slice) continue;
      const key = pool.view[page],
        view = sunLight ? key - sun.finest[slice] : (key >> 4) * LAMP_MIPS + (key & 15);
      if (!covered || within(view, pool.x[page], pool.y[page])) mark(page, level, wrong);
    }
  };
  /** The table entries the rectangles hold: a mapped one names its page. */
  const walk = (level: number, wrong: boolean) => {
    const base = table.baseOf(slice),
      finest = sun.finest[slice];
    for (let view = 0; view < views; view++) {
      const r = view * 4;
      for (let y = rects[r + 2]; y <= rects[r + 3]; y++) {
        // A sun row is a ring of the extent, a lamp row a run of its mip.
        const row =
          base +
          (sunLight
            ? sunEntry(finest + view, 0, y)
            : lampEntry(Math.floor(view / LAMP_MIPS), view % LAMP_MIPS, 0, y));
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
    lightSlice: number,
    whole: boolean,
    byPage: boolean,
    now: number,
    at: number,
  ) => {
    const rank = LIGHT_KIND[light.kind];
    slice = lightSlice;
    sunLight = rank === LIGHT_KIND.directional;
    views = sunLight ? SUN_LEVELS : lampFacesOf(rank) * LAMP_MIPS;
    nowMs = now;
    frame = at;
    if (whole) {
      scan(false, STALE_FULL, true);
      return;
    }
    const range = sunLight ? 0 : (light.range ?? 0),
      position = light.position ?? ORIGIN;
    if (!sunLight && byPage && changes.count) lampFaces(light);
    // Per page: each box exactly, within the light's virtual pages, then the rest unions. Off: one
    // scan at the strongest level, withdrawing when any box is wrong.
    let budget = tableEntriesOf(rank),
      level = 0,
      wrong = false;
    boxEmpty(restWrong, 0);
    boxEmpty(restKept, 0);
    for (let box = 0; box < changes.count; box++) {
      if (!changes.touches(box, position[0], position[1], position[2], range)) continue;
      const moved = changes.read(box),
        boxLevel = moved.moving ? STALE_DYNAMIC : STALE_FULL,
        boxWrong = !moved.detail && !moved.moving;
      if (!byPage) {
        level = Math.max(level, boxLevel);
        wrong ||= boxWrong;
        continue;
      }
      const covered = project(moved.min, moved.max),
        cost = Math.min(covered, pool.pages);
      if (cost <= budget) {
        budget -= cost;
        if (covered > pool.pages) scan(true, boxLevel, boxWrong);
        else walk(boxLevel, boxWrong);
        continue;
      }
      const { min, max } = moved;
      if (boxWrong) wrong = true;
      else level = Math.max(level, boxLevel);
      boxUnion(boxWrong ? restWrong : restKept, 0, min[0], min[1], min[2], max[0], max[1], max[2]);
    }
    if (!byPage) {
      if (level) scan(false, level, wrong);
      return;
    }
    // The wrong union stales whole and withdraws; the kept one at its strongest level.
    if (wrong) {
      project(wrongMin, wrongMax);
      scan(true, STALE_FULL, true);
    }
    if (level) {
      project(keptMin, keptMax);
      scan(true, level, false);
    }
  };
}
