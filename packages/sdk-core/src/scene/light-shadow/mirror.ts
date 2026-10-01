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
  /** 1 where the GPU's own draw holds the page's depth (#831); absent, none is known. */
  gpuDrawn?: Uint8Array;
  /** Pages that frame mapped, and entries it had no page for. */
  allocated: number;
  /** Entries that frame had no page for. */
  refused: number;
  /** Pages that frame listed for the GPU to draw (`listDraw`). */
  drawn: number;
  /** Pages every frame listed since the pool's seed: moves with any frame's list, its own
   *  snapshot lost or not. */
  listings: number;
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
 * last drop of a slice's pages (`records.generation`) or a seed of the GPU's pool (`set`). The next
 * one follows. Allocates nothing past construction. A mirror made anew for the granted pool
 * (`plan.size`) carries on the one before's allocation and drawn count (`previous`).
 */
export function createShadowMirror(
  table: ShadowTable,
  pool: ShadowPool,
  records: ShadowRecords,
  sun: SunLevels,
  previous?: {
    on: boolean;
    drawn: number;
    drewAt: number;
    drewLast: number;
    layeredFrom?: number;
    firstDrew?: number;
  },
  /** Per slice, the last frame an invalidation missed the pages the host has not adopted
   *  (`invalidate.ts`, `lightWideAt`): a GPU draw before it is not kept. */
  lightWideAt?: ArrayLike<number>,
) {
  const entries = createEntryPages(table, records, sun),
    at = new Int32Array(3);
  let from = 0,
    drops = records.drops,
    /** The frame of the last snapshot followed: a page it did not map was drawn after it. */
    followed = -Infinity;
  const apply = (
    snapshot: ShadowPoolSnapshot,
    reportFrame: number,
    nowMs: number,
    frame: number,
  ) => {
    const { owner, requested } = snapshot;
    // Every GPU draw since the last snapshot wrote the static layer too (`freshPass.ts`): a page
    // this one maps for the first time was drawn since, its still casters in the layer.
    const layered = followed >= mirror.layeredFrom,
      /** The earliest frame a page this snapshot maps anew was drawn in. */
      drawnFrom = Math.max(followed + 1, mirror.firstDrew);
    followed = reportFrame;
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
      // Drawn once, as the reference engine draws a page: the GPU's draw is kept, never drawn again by the host
      // until what it holds changes, restored from its static layer when it holds one (#831).
      // Not when a light-wide invalidation since its draw reached the host's pages alone.
      if (snapshot.gpuDrawn?.[page] && !((lightWideAt?.[slice] ?? -Infinity) > drawnFrom))
        pool.keepDraw(page, entries.isSun(slice) ? sun.ranges.current[slice] : 0, layered);
    }
    if (moved) pool.rebuildFree();
  };
  const mirror = {
    /** What the host asks the GPU for beside the pixels, this frame (`requests.floors`). */
    asks: { entries: new Uint32Array(shadowRequestCap(pool.pages)), count: 0 } as ShadowAsks,
    /** True while the GPU allocates. */
    on: previous?.on ?? false,
    /** The `listings` of the latest snapshot at or past a frame whose GPU page draws ran: the
     *  shadow contents' version as the GPU's own draws move it (`shadowEpoch.ts`), a frame whose
     *  snapshot is lost counted by the next. */
    drawn: previous?.drawn ?? 0,
    /** The first frame the GPU's page draws ran (`drew`) since a snapshot last counted them;
     *  none, Infinity. The first, not the latest: while draws run every frame (a moving view),
     *  each snapshot comes back after a later draw, and would never count. */
    drewAt: previous?.drewAt ?? Infinity,
    /** The latest frame the GPU's page draws ran; none, −Infinity. A snapshot that counts comes
     *  back while later draws already ran: the first of those is only known to be by this one. */
    drewLast: previous?.drewLast ?? -Infinity,
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
    /** The first frame from which every GPU page draw wrote the static layer too; none, Infinity. */
    layeredFrom: previous?.layeredFrom ?? Infinity,
    /** The first frame the GPU's page draws ran; none, Infinity. */
    firstDrew: previous?.firstDrew ?? Infinity,
    /** Frame `frame` ran the GPU's page draws (`freshPass.ts`): every page it listed is drawn, its
     *  still casters into the static layer too when `layered`. */
    drew(frame: number, layered = false) {
      if (!layered) mirror.layeredFrom = Infinity;
      else if (mirror.layeredFrom === Infinity) mirror.layeredFrom = frame;
      mirror.firstDrew = Math.min(mirror.firstDrew, frame);
      mirror.drewAt = Math.min(mirror.drewAt, frame);
      mirror.drewLast = Math.max(mirror.drewLast, frame);
    },
    /** A report came back: what its frame listed counts at once, read by the plan or not — an
     *  image does not hold on pages its GPU mapped and has not drawn (`shadowsUnsettled`, #1344).
     *  Its listings move the shadow version only once a draw ran by its frame: a page listed and
     *  not drawn is listed again each frame until it is, and changes no image (#1346). */
    hear(report: ShadowRequestReport) {
      if (!report.pool) return;
      mirror.listed = report.pool.drawn;
      if (report.frame < mirror.drewAt) return;
      mirror.drawn = report.pool.listings;
      // Draws after its frame stay to count, by the snapshot of the latest one at the latest.
      mirror.drewAt = mirror.drewLast > report.frame ? mirror.drewLast : Infinity;
    },
    /** Follows the GPU's pool in `report`; false when it is not the GPU's, or can no longer be. */
    follow(report: ShadowRequestReport, nowMs: number, frame: number) {
      const snapshot = report.pool;
      if (!snapshot || report.frame < from || snapshot.owner.length !== pool.pages) return false;
      if (report.layoutEpoch !== table.layoutEpoch) return false;
      apply(snapshot, report.frame, nowMs, frame);
      return true;
    },
  };
  return mirror;
}
