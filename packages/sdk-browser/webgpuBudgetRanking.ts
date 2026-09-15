import type { PageRec } from './pageSelection.ts';
import { createDenseKeySet } from './webgpuDenseKeys.ts';

const levelOf = (page: PageRec) => page.level ?? 0;

/**
 * Ranks the cut the page budget has to cut down: coarsest level first, publication order within a
 * level — exactly what a stable descending sort by level gives, obtained by counting instead of
 * comparing, and without ever materialising the levels the budget will not reach.
 *
 * What is weighed is **pages**, not placements. The budget it is compared against is a number of
 * cache slots, and a slot holds a page: two placements of one page — the same cluster under two
 * instances of an object — occupy one slot and must count once. Counting placements made the budget
 * refuse cuts that fit ten times over, and the queue it then wrote was a prefix whose page count
 * depended on how the placements happened to be distributed, so the resident set depended on the
 * order the network had filled it in. A page's level is a property of the page, so keys partition by
 * level exactly as placements did, and the counting rank is unchanged in kind.
 *
 * The opaque cut's keys are counted per level once and then moved by the cut difference alone, so an
 * image that enters and leaves no page re-counts nothing. Only the transparent tail, which no
 * readback describes, is re-read. Nothing is allocated once the budget is known.
 */
export function createBudgetRanking(options: {
  keyCount: number;
  bootstrapKey: Uint8Array;
  keyOf: (page: PageRec) => number;
}) {
  const { keyCount, bootstrapKey, keyOf } = options;
  /** Non-cover pages of the opaque cut, per level and in total, carried between images. */
  let held = new Int32Array(8),
    counts = new Int32Array(8),
    cursors = new Int32Array(8);
  /** Placements holding each key, and the keys they hold: a key counts once however many hold it. */
  const refs = new Int32Array(Math.max(1, keyCount));
  const heldKeys = createDenseKeySet(keyCount);
  /** The ranked prefix, one entry per page, and the keys beside it. Sized to the budget once. */
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
    /** Pages of the opaque cut the budget weighs, the pinned cover excluded. */
    get pageCount() {
      return heldKeys.count;
    },
    /** One placement of the opaque cut joins the weighed set; the cover is never weighed. */
    add(page: PageRec) {
      const key = keyOf(page);
      if (bootstrapKey[key] || refs[key]++ > 0) return;
      const level = levelOf(page);
      grow(level);
      held[level]++;
      heldKeys.add(key);
    },
    /** One placement leaves it; the page leaves only with its last placement. */
    remove(page: PageRec) {
      const key = keyOf(page);
      if (bootstrapKey[key] || refs[key] <= 0 || --refs[key] > 0) return;
      held[levelOf(page)]--;
      heldKeys.remove(key);
    },
    clear() {
      for (let i = heldKeys.count - 1; i >= 0; i--) refs[heldKeys.list[i]] = 0;
      heldKeys.clear();
      held.fill(0);
    },
    /** True when the queue already holds exactly the ranked prefix, in the same order. */
    matches(list: Int32Array, count: number, pages: readonly PageRec[]) {
      if (count !== length) return false;
      for (let i = 0; i < length; i++)
        if (list[i] !== keys[i] || pages[i] !== ranked[i]) return false;
      return true;
    },
    /**
     * Counts the pages the budget weighs and, when that overruns `room`, writes the prefix it keeps
     * into `ranked`/`keys`. Returns the page count so the caller can tell a cut that fits from one
     * that does not without counting it twice.
     */
    rank(room: number, cut: readonly PageRec[], transparent: readonly PageRec[]) {
      let records = heldKeys.count;
      counts.set(held);
      epoch++;
      for (let i = 0; i < transparent.length; i++) {
        const page = transparent[i],
          key = keyOf(page);
        if (bootstrapKey[key] || seen[key] === epoch || refs[key] > 0) continue;
        seen[key] = epoch;
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
      // first `atCut` pages and the finer levels give none.
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
      // One entry per page: the first placement in the ranked order is the record it is fetched by.
      epoch++;
      let left = atCut;
      for (let i = 0; i < cut.length; i++) {
        const page = cut[i],
          key = keyOf(page),
          level = levelOf(page);
        if (level < floor || bootstrapKey[key] || seen[key] === epoch) continue;
        if (level === floor) {
          if (left === 0) continue;
          left--;
        }
        seen[key] = epoch;
        keys[cursors[level]] = key;
        ranked[cursors[level]] = page;
        cursors[level]++;
      }
      length = room;
      return records;
    },
  };
}
