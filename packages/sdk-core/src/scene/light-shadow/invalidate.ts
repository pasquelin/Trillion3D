import { boxEmpty, boxUnion } from '../../math/primitives/box.ts';
import { LIGHT_KIND, type SceneLight } from '../light/contracts.ts';
import { createLightWideStamps } from './lightWide.ts';
import type { createShadowChanges } from './changes.ts';
import { STALE_BY, type createShadowCounts } from './counts.ts';
import { createPageRects, rectHolds } from './pageRects.ts';
import { STALE_DYNAMIC, STALE_FULL, type ShadowPool } from './pool.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';
import {
  LAMP_MIPS,
  PAGE_INDEX_MASK,
  PAGE_MAPPED,
  SUN_LEVELS,
  lampFacesOf,
  tableEntriesOf,
} from './virtual.ts';
import { lampEntry, ringOf, sunEntry } from './pageModel.ts';

type Changes = ReturnType<typeof createShadowChanges>;
type Counts = ReturnType<typeof createShadowCounts>;

const ORIGIN = [0, 0, 0] as const; // the position of a light that has none, the sun
/** Why a box stales its pages (`STALE_BY`): wrong, a still caster changed; at `STALE_FULL` and not
 *  wrong, a change of detail; else, moving casters alone (a box of detail alone passes `detail`). */
const reasonOf = (level: number, wrong: boolean) =>
  wrong ? STALE_BY.caster : level === STALE_FULL ? STALE_BY.detail : STALE_BY.moving;

/**
 * What stales the mapped pages of a shadow light, and nothing more — the reference invalidation of
 * virtual shadow maps. Only mapped pages can be stale: a page nobody reads has no content to keep,
 * and is drawn whole when first asked for. While the GPU maps pages too (`mirror.ts`), an entry a
 * box covers that the host does not map goes out withdrawn, its GPU draw redone this frame (#831),
 * once until a GPU page draw runs again (`table.withdrawUnmapped`), and a light-wide stale bars
 * the GPU's older draws (`lightWide.ts`).
 *
 * - **The light moved, changed shape, or its clipmap changed frame** (`whole`): every page,
 *   the floor too, and none is read until redrawn (`pool.withdraw`) — its depth was drawn under a
 *   projection the record no longer holds. The floor is drawn first (`admit.ts`); a face whose
 *   floor the frame cannot draw reads no shadow. A sun's new depth range stales nothing: each page
 *   is read in the range it was drawn in (`sunDepth.ts`), save those of the slot the new range
 *   took (`recycled`), withdrawn alike.
 * - **An object moved within its reach**: in each light view — a sun level, a lamp face at a
 *   mip —, exactly the pages its box covers, never a neighbour's: the entries walked through the
 *   page table, or, when they outnumber the pool's pages, one pool scan against its rectangles.
 *   A light examines at most its virtual pages (`tableEntriesOf`) — past that its boxes cover its
 *   entries again —: the boxes beyond join one union per kind, each covered the same way. A
 *   static caster that moved withdraws those pages until redrawn; one already moving stales only
 *   their moving casters, and the static layer under them stays read. With per-page invalidation
 *   off, every page of each light the box touches.
 * - **The representation changed** (`changes.ts`): the same pages, stale for detail only, read
 *   until redrawn.
 *
 * Adds the pages staled and the pages visited to `counts`.
 */
export function createPageInvalidation(
  pool: ShadowPool,
  table: ShadowTable,
  sun: SunLevels,
  changes: Changes,
  counts: Counts,
  gpuMaps: () => boolean = () => false,
) {
  const { rects, sunRects, lampFaces, lampRects } = createPageRects();
  /** The unions of a light's boxes past its budget, covered once each: those whose static layer
   *  is wrong, and the others — a moving caster past the budget keeps the static layer read. */
  const restWrong = new Float64Array(6),
    restKept = new Float64Array(6),
    wrongMin = restWrong.subarray(0, 3),
    wrongMax = restWrong.subarray(3, 6),
    keptMin = restKept.subarray(0, 3),
    keptMax = restKept.subarray(3, 6);
  /** The light invalidated — slice, kind, views —, the frame's stamp, whether the GPU maps. */
  let slice = 0,
    sunLight = false,
    views = 0,
    nowMs = 0,
    frame = 0,
    gpuDraws = false;
  const wide = createLightWideStamps();
  /** Stales `page` at `level`, counted under `reason` (`STALE_BY`), withdrawn when `wrong`, the
   *  GPU's own draw too (#1345). */
  const mark = (page: number, level: number, wrong: boolean, reason: number) => {
    if (pool.stale(page, nowMs, frame, level)) counts.staled(reason);
    if (wrong) pool.withdraw(table, page, true);
  };
  const within = (view: number, x: number, y: number) => rectHolds(rects, views, view, x, y);
  /** The rectangles of box `min..max` — of `moving` casters alone — in each view of the light:
   *  returns the pages covered. */
  const project = (min: ArrayLike<number>, max: ArrayLike<number>, moving = false) =>
    sunLight ? sunRects(sun, slice, min, max, moving) : lampRects(min, max);
  /** Every page of the light — or only those drawn in depth-range slot `range` —, or, `covered`,
   *  those the rectangles hold: stale at `level`, and withdrawn when `wrong`, for `reason`. */
  const scan = (
    covered: boolean,
    level: number,
    wrong: boolean,
    range = -1,
    reason = reasonOf(level, wrong),
  ) => {
    if (gpuDraws) wide.at[slice] = frame;
    counts.visitedPages += pool.pages;
    for (let page = 0; page < pool.pages; page++) {
      if (pool.owner[page] < 0 || pool.slice[page] !== slice) continue;
      if (range >= 0 && pool.range[page] !== range) continue;
      const key = pool.view[page],
        view = sunLight ? key - sun.finest[slice] : (key >> 4) * LAMP_MIPS + (key & 15);
      if (!covered || within(view, pool.x[page], pool.y[page])) mark(page, level, wrong, reason);
    }
  };
  /** The table entries the rectangles hold: a mapped one names its page. */
  const walk = (level: number, wrong: boolean, reason = reasonOf(level, wrong)) => {
    const base = table.baseOf(slice),
      finest = sun.finest[slice];
    for (let view = 0; view < views; view++) {
      const r = view * 4;
      for (let y = rects[r + 2]; y <= rects[r + 3]; y++) {
        // A sun row is a ring of the extent, a lamp row a run of its mip.
        const row =
          base +
          (sunLight
            ? sunEntry(finest + view, 0, y, sun.windowPages)
            : lampEntry(Math.floor(view / LAMP_MIPS), view % LAMP_MIPS, 0, y));
        for (let x = rects[r]; x <= rects[r + 1]; x++) {
          counts.visitedPages++;
          const entry = row + (sunLight ? ringOf(x, sun.windowPages) : x),
            word = table.words[entry];
          if (word & PAGE_MAPPED) mark(word & PAGE_INDEX_MASK, level, wrong, reason);
          else if (gpuDraws) table.withdrawUnmapped(entry);
        }
      }
    }
  };
  /** The `covered` pages the rectangles hold: walked, or one pool scan when more than the pool. */
  const cover = (covered: number, level: number, wrong: boolean, reason?: number) =>
    covered > pool.pages ? scan(true, level, wrong, -1, reason) : walk(level, wrong, reason);
  const invalidate = (
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
    gpuDraws = gpuMaps();
    if (sunLight) wide.sunRange(slice, sun.ranges.current[slice], gpuDraws, frame);
    if (whole) {
      scan(false, STALE_FULL, true, -1, STALE_BY.light);
      return;
    }
    const recycled = sunLight ? sun.ranges.recycled[slice] : -1;
    if (recycled >= 0) scan(false, STALE_FULL, true, recycled, STALE_BY.range);
    const range = sunLight ? 0 : (light.range ?? 0),
      position = light.position ?? ORIGIN;
    if (!sunLight && byPage && changes.count) lampFaces(light);
    // Per page: each box exactly, within the light's virtual pages, then the rest unions. Off: one
    // scan at the strongest level, withdrawing when any box is wrong.
    let budget = tableEntriesOf(rank, sun.windowPages),
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
      const covered = project(moved.min, moved.max, moved.moving),
        cost = Math.min(covered, pool.pages);
      if (cost <= budget) {
        budget -= cost;
        cover(covered, boxLevel, boxWrong, moved.detail ? STALE_BY.detail : undefined);
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
    if (wrong) cover(project(wrongMin, wrongMax), STALE_FULL, true);
    if (level) cover(project(keptMin, keptMax), level, false);
  };
  return Object.assign(invalidate, { lightWideAt: wide.at });
}
