import { footprintUnion } from './footprint.ts';
import { STALE_FULL, type ShadowPool } from './pool.ts';

/**
 * THE ONE WAY A PAGE'S FOOTPRINT GROWS: to its union with `footprint`, never less — a reader it
 * covered stays covered while the page is mapped. A drawn page it grows is stale in full, its
 * static layer too, for their casters were culled to the old one (`pages.ts`). True when that
 * staled a current page.
 */
export function reachFootprint(
  pool: ShadowPool,
  page: number,
  footprint: number,
  nowMs: number,
  frame: number,
) {
  const next = footprintUnion(pool.footprint[page], footprint);
  if (next === pool.footprint[page]) return false;
  pool.footprint[page] = next;
  return !!pool.valid[page] && pool.stale(page, nowMs, frame, STALE_FULL);
}
