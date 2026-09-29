import { createEntryPages } from './entryPages.ts';
import type { ShadowPool } from './pool.ts';
import type { ShadowRecords } from './records.ts';
import type { ShadowAsks, ShadowRequestReport } from './requests.ts';
import type { ShadowTable } from './table.ts';
import type { SunLevels } from './sunLevels.ts';
import { shadowRequestCap } from './virtual.ts';

/** The GPU allocator's pool after one frame's allocation (`webgpu/shadow/allocWgsl.ts`). */
export interface ShadowPoolSnapshot {
  /** The entry each physical page maps, −1 for a free one. */
  owner: Int32Array;
  /** The frame each page was last asked for in. */
  requested: Int32Array;
  /** Pages that frame mapped, and entries it had no page for. */
  allocated: number;
  refused: number;
  /** Pages that frame listed for the GPU to draw (`listDraw`). */
  drawn: number;
}

/**
 * THE HOST MIRROR OF THE GPU'S PAGES (#1275). When the GPU allocates, it maps the pages a frame's
 * pixels ask for in that frame, evicts by last request and writes their table words itself; the
 * host keeps creating the resources and holding the memory grant, and learns what the GPU did from
 * the snapshot each request report carries. It follows it here: a page the GPU gave another entry
 * or freed is released — its word the GPU's already —, a page it mapped is adopted as a take maps
 * it — stale, read once drawn — and every page takes the GPU's last request. Identity, residency
 * and validity keep their rules: only the GPU maps, only a draw makes a page readable
 * (`pool.drew`), and a word the host sends is kept only for the page the GPU says it names.
 *
 * A snapshot the pool can no longer follow is left: one of another pool size, or taken before the
 * last drop of a slice's pages (`records.generation`), a resize or a seed of the GPU's pool
 * (`set`). The next one follows. Allocates nothing past construction.
 */
export function createShadowMirror(
  table: ShadowTable,
  pool: ShadowPool,
  records: ShadowRecords,
  sun: SunLevels,
) {
  const entries = createEntryPages(table, records, sun),
    at = new Int32Array(3);
  let from = 0,
    drops = records.drops;
  const apply = (
    snapshot: ShadowPoolSnapshot,
    reportFrame: number,
    nowMs: number,
    frame: number,
  ) => {
    const { owner, requested } = snapshot;
    let moved = false;
    for (let page = 0; page < pool.pages; page++) {
      if (owner[page] === pool.owner[page]) continue;
      // Released first, all of them: an entry the GPU moved is unmapped before it maps again.
      pool.release(table, page, owner[page] >= 0);
      moved = true;
    }
    for (let page = 0; page < pool.pages; page++) {
      const entry = owner[page];
      if (entry < 0) continue;
      if (entry === pool.owner[page]) {
        pool.requested[page] = Math.max(pool.requested[page], requested[page]);
        continue;
      }
      const slice = table.sliceAt(entry);
      if (slice < 0 || !entries.decode(entry, slice, reportFrame, at)) continue;
      pool.adopt(table, page, entry, requested[page], nowMs, frame);
      pool.slice[page] = slice;
      pool.view[page] = at[0];
      pool.x[page] = at[1];
      pool.y[page] = at[2];
      pool.rank[page] = entries.rankOf(slice, at);
    }
    if (moved) pool.rebuildFree();
  };
  const mirror = {
    /** What the host asks the GPU for beside the pixels, this frame (`requests.floors`). */
    asks: { entries: new Uint32Array(shadowRequestCap(pool.pages)), count: 0 } as ShadowAsks,
    /** True while the GPU allocates. */
    on: false,
    /** Pages the latest snapshot's frame listed for the GPU to draw: while some are, the GPU's
     *  page draws run (`freshPass.ts`). */
    listed: 0,
    /** The view or the world moved at the last plan: a surface, a caster's own too, may ask pages
     *  no frame before did, and the GPU's page draws run (`freshPass.ts`). */
    moved: false,
    /** The GPU allocates, its pool written from the host's, or no longer does, from frame `frame`
     *  on: snapshots before are left. */
    set(allocate: boolean, frame: number) {
      mirror.on = allocate;
      from = Math.max(from, frame);
    },
    /** Frame `frame`'s plan, the view or world `moved` or not, dropped pages or not
     *  (`records.drops`): snapshots before a drop are left. */
    noteFrame(frame: number, moved: boolean) {
      mirror.moved = moved;
      if (records.drops === drops) return;
      drops = records.drops;
      from = Math.max(from, frame);
    },
    /** Follows the GPU's pool in `report`; false when it is not the GPU's, or can no longer be. */
    follow(report: ShadowRequestReport, nowMs: number, frame: number) {
      const snapshot = report.pool;
      if (snapshot) mirror.listed = snapshot.drawn;
      if (!snapshot || report.frame < from || snapshot.owner.length !== pool.pages) return false;
      if (report.layoutEpoch !== table.layoutEpoch) return false;
      apply(snapshot, report.frame, nowMs, frame);
      return true;
    },
  };
  return mirror;
}
