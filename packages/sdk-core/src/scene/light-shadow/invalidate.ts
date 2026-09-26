import { LIGHT_KIND, type SceneLight } from '../light/contracts.ts';
import type { createShadowChanges } from './changes.ts';
import type { createShadowCounts } from './counts.ts';
import { lampFaces, lampRects, rects, sunRects } from './pageRects.ts';
import { STALE_DYNAMIC, STALE_FULL, type ShadowPool } from './pool.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';
import { LAMP_MIPS, PAGE_INDEX_MASK, PAGE_MAPPED, SUN_LEVELS } from './virtual.ts';
import { lampEntry, lampFacesOf, sunEntry } from './virtual.ts';

type Changes = ReturnType<typeof createShadowChanges>;
type Counts = ReturnType<typeof createShadowCounts>;

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
    if (!sunLight && byPage && changes.count) lampFaces(light, faces);
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
