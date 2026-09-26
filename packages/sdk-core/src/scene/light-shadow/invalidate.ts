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
 *   pages covered, never the pool. Once a light's boxes cover more entries than the pool holds
 *   pages, the rest join one union per kind — static layer wrong or kept —, read by one scan of
 *   the pool: a light's work stays within twice the pool. A static caster that moved makes the
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
  /** The unions of a light's boxes past its walk budget, scanned once: those whose static layer is
   *  wrong, and the others — a moving caster past the budget keeps the static layer under it read.
   *  The wrong union's rectangles are set aside while the other's are projected. */
  const restWrong = new Float64Array(6),
    restKept = new Float64Array(6),
    wrongMin = restWrong.subarray(0, 3),
    wrongMax = restWrong.subarray(3, 6),
    keptMin = restKept.subarray(0, 3),
    keptMax = restKept.subarray(3, 6),
    wrongRects = new Float64Array(rects.length);
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
  const within = (of: Float64Array, view: number, x: number, y: number) =>
    view >= 0 &&
    view < views &&
    x >= of[view * 4] &&
    x <= of[view * 4 + 1] &&
    y >= of[view * 4 + 2] &&
    y <= of[view * 4 + 3];
  /** The rectangles of box `min..max` in each view of the light: returns the pages covered. */
  const project = (min: ArrayLike<number>, max: ArrayLike<number>) =>
    sunLight ? sunRects(sun, slice, min, max) : lampRects(min, max);
  /**
   * Every page of the light at `level`, withdrawn when `wrong`; or, `covered`, the pages of the
   * rest unions: the wrong one's (`wrongRects`) stale whole and withdrawn when `wrong`, the kept
   * one's (`rects`) stale at `level` when it is set.
   */
  const scan = (covered: boolean, level: number, wrong: boolean) => {
    counts.visitedPages += pool.pages;
    for (let page = 0; page < pool.pages; page++) {
      if (pool.owner[page] < 0 || pool.slice[page] !== slice) continue;
      if (!covered) {
        mark(page, level, wrong);
        continue;
      }
      const key = pool.view[page],
        view = sunLight ? key - sun.finest[slice] : (key >> 4) * LAMP_MIPS + (key & 15),
        x = pool.x[page],
        y = pool.y[page];
      if (wrong && within(wrongRects, view, x, y)) mark(page, STALE_FULL, true);
      else if (level && within(rects, view, x, y)) mark(page, level, false);
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
    slice = lightSlice;
    sunLight = light.kind === 'directional';
    views = sunLight ? SUN_LEVELS : lampFacesOf(LIGHT_KIND[light.kind]) * LAMP_MIPS;
    nowMs = now;
    frame = at;
    if (whole) {
      scan(false, STALE_FULL, true);
      return;
    }
    const range = sunLight ? 0 : (light.range ?? 0),
      position = light.position ?? ORIGIN;
    if (!sunLight && byPage && changes.count) lampFaces(light);
    // With per-page invalidation on, each box walks the table entries it covers while the light's
    // walks stay within the pool's pages; the boxes past that join a rest union by what they stale,
    // scanned once at the end. Off, every box that touches stales every page: one scan at the
    // strongest level, withdrawing when any box is wrong, does what one scan a box would.
    let budget = pool.pages,
      level = 0,
      wrong = false;
    boxEmpty(restWrong, 0);
    boxEmpty(restKept, 0);
    for (let box = 0; box < changes.count; box++) {
      if (!changes.touches(box, position[0], position[1], position[2], range)) continue;
      const moved = changes.read(box),
        boxLevel = moved.moving ? STALE_DYNAMIC : STALE_FULL,
        boxWrong = !moved.detail && !moved.moving;
      if (byPage) {
        const covered = project(moved.min, moved.max);
        if (covered <= budget) {
          budget -= covered;
          walk(boxLevel, boxWrong);
          continue;
        }
        const { min, max } = moved,
          into = boxWrong ? restWrong : restKept;
        boxUnion(into, 0, min[0], min[1], min[2], max[0], max[1], max[2]);
        // The wrong union stales whole: `level` is the kept union's alone.
        if (boxWrong) wrong = true;
        else level = Math.max(level, boxLevel);
        continue;
      }
      level = Math.max(level, boxLevel);
      wrong ||= boxWrong;
    }
    if (!level && !wrong) return;
    if (byPage && wrong) {
      project(wrongMin, wrongMax);
      wrongRects.set(rects);
    }
    if (byPage && level) project(keptMin, keptMax);
    scan(byPage, level, wrong);
  };
}
