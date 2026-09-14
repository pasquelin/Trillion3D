import type { PageRec } from './pageSelection.ts';

const levelOf = (page: PageRec) => page.level ?? 0;

/**
 * Ranks the cut the page budget has to cut down: coarsest level first, publication order within a
 * level — exactly what a stable descending sort by level gives, obtained by counting instead of
 * comparing, and without ever materialising the levels the budget will not reach.
 *
 * The opaque cut's placements are counted per level once and then moved by the cut difference alone,
 * so an image that enters and leaves no page re-counts nothing. Only the transparent tail, which no
 * readback describes, is re-read. Ranking then needs a single pass over the cut: the levels above the
 * cut-off are taken whole, the level that straddles it contributes its first records, and everything
 * finer is skipped on the level test alone. Nothing is allocated once the budget is known.
 */
export function createBudgetRanking(options: {
  keyCount: number;
  bootstrapKey: Uint8Array;
  keyOf: (page: PageRec) => number;
}) {
  const { keyCount, bootstrapKey, keyOf } = options;
  /** Non-cover placements of the opaque cut, per level and in total, carried between images. */
  let held = new Int32Array(8),
    counts = new Int32Array(8),
    cursors = new Int32Array(8);
  let placements = 0;
  /** The ranked prefix, deduplicated by key, and the keys beside it. Sized to the budget once. */
  const ranked: PageRec[] = [];
  let keys = new Int32Array(0);
  const seen = new Int32Array(Math.max(1, keyCount)).fill(-1);
  let epoch = 0,
    length = 0;
  const grow = (level: number) => {
    if (level < held.length) return;
    const size = 1 << (32 - Math.clz32(level));
    const nextHeld = new Int32Array(size),
      nextCounts = new Int32Array(size);
    nextHeld.set(held);
    nextCounts.set(counts);
    held = nextHeld;
    counts = nextCounts;
    cursors = new Int32Array(size);
  };
  return {
    ranked,
    get keys() {
      return keys;
    },
    get length() {
      return length;
    },
    /** One placement of the opaque cut joins the weighed set; the cover is never weighed. */
    add(page: PageRec) {
      if (bootstrapKey[keyOf(page)]) return;
      const level = levelOf(page);
      grow(level);
      held[level]++;
      placements++;
    },
    /** One placement leaves it. */
    remove(page: PageRec) {
      if (bootstrapKey[keyOf(page)]) return;
      held[levelOf(page)]--;
      placements--;
    },
    clear() {
      held.fill(0);
      placements = 0;
    },
    /** True when the queue already holds exactly the ranked prefix, in the same order. */
    matches(list: Int32Array, count: number, pages: readonly PageRec[]) {
      if (count !== length) return false;
      for (let i = 0; i < length; i++)
        if (list[i] !== keys[i] || pages[i] !== ranked[i]) return false;
      return true;
    },
    /**
     * Counts what the budget weighs and, when that overruns `room`, writes the prefix it keeps into
     * `ranked`/`keys`. Returns the record count so the caller can tell a cut that fits from one that
     * does not without counting it twice.
     */
    rank(room: number, cut: readonly PageRec[], transparent: readonly PageRec[]) {
      let records = placements;
      counts.set(held);
      for (let i = 0; i < transparent.length; i++) {
        const page = transparent[i];
        if (bootstrapKey[keyOf(page)]) continue;
        const level = levelOf(page);
        grow(level);
        counts[level]++;
        records++;
      }
      if (records <= room) return records;
      if (keys.length < room) {
        keys = new Int32Array(room);
        ranked.length = room;
      }
      // The coarsest levels are kept whole until one of them straddles the budget; that one gives its
      // first `atCut` records and the finer levels give none.
      let taken = 0,
        floor = 0,
        atCut = 0;
      for (let level = counts.length - 1; level >= 0; level--) {
        if (taken + counts[level] >= room) {
          floor = level;
          atCut = room - taken;
          break;
        }
        taken += counts[level];
      }
      let base = 0;
      for (let level = counts.length - 1; level > floor; level--) {
        cursors[level] = base;
        base += counts[level];
      }
      cursors[floor] = base;
      let left = atCut;
      for (let i = 0; i < cut.length; i++) {
        const page = cut[i],
          level = levelOf(page);
        if (level < floor || bootstrapKey[keyOf(page)]) continue;
        if (level === floor) {
          if (left === 0) continue;
          left--;
        }
        ranked[cursors[level]++] = page;
      }
      // Several placements of one page share one key, and the queue holds a key once: the first
      // placement in the ranked order is the record the queue fetches it by.
      epoch++;
      length = 0;
      for (let i = 0; i < room; i++) {
        const page = ranked[i],
          key = keyOf(page);
        if (seen[key] === epoch) continue;
        seen[key] = epoch;
        keys[length] = key;
        ranked[length] = page;
        length++;
      }
      return records;
    },
  };
}
