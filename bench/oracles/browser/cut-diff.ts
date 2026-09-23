// Oracles of the "cut by delta" batch: the previous code, copied as-is. The four cut
// readers rewalked the list published by the sample every frame; the bench compares them
// to those that now read only a delta. The copies are wanted duplicates: that is the oracle.
import type {
  PageRec,
  RequestStamps,
} from '../../../packages/sdk-browser/src/page/selection/selection.ts';

/** `packages/sdk-browser/src/webgpu/pages/helpers.ts:shownFromGpu` before the batch: four totals of one pass over the whole cut. */
export function referenceCutCounts(
  pages: readonly (PageRec | undefined)[],
  ids: readonly number[],
  residentOffsetWords: Int32Array,
) {
  let selected = 0,
    uncovered = 0,
    transparent = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i],
      rec = pages[id];
    if (!rec) continue;
    selected += rec.triangles;
    if (rec.transparent) transparent += rec.triangles;
    if (residentOffsetWords[id] < 0 || !rec.array) uncovered += rec.triangles;
  }
  return {
    selectedTriangles: selected,
    drawnTriangles: selected - uncovered,
    uncoveredTriangles: uncovered,
    transparentTriangles: transparent,
  };
}

/** `packages/sdk-browser/src/webgpu/frame/hold.ts:cutComplete` before the batch: the whole cut reread for a single verdict. */
export function referenceCutComplete(desired: readonly PageRec[]) {
  for (let i = 0; i < desired.length; i++) if (!desired[i].array) return false;
  return true;
}

/** `packages/sdk-browser/src/webgpu/pages/io/hostApi.ts:pendingUrls` before the batch: `collectPendingUrls` on the whole cut. */
export function referencePendingUrls(
  desired: readonly PageRec[],
  stamps: RequestStamps,
  into: string[],
) {
  into.length = 0;
  stamps.begin();
  return stamps.mark(desired, into, true);
}

/**
 * `packages/sdk-browser/src/webgpu/residency/budgetRanking.ts` before the batch, copied as-is: per-level counts were already
 * held by `add`/`remove`; only the prefix was written by walking the whole cut, one
 * stamp per key for dedup. Only that walk changes, and it is what the bench weighs.
 */
export function createReferenceRanking({
  keyCount,
  bootstrapKey,
  keyOf,
}: {
  keyCount: number;
  bootstrapKey: Uint8Array;
  keyOf: (page: PageRec) => number;
}) {
  const levelOf = (page: PageRec) => page.level ?? 0;
  let held = new Int32Array(8),
    counts = new Int32Array(8),
    cursors = new Int32Array(8);
  const refs = new Int32Array(Math.max(1, keyCount));
  const heldKeys = new Uint8Array(Math.max(1, keyCount));
  let heldCount = 0;
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
    add(page: PageRec) {
      const key = keyOf(page);
      if (bootstrapKey[key] || refs[key]++ > 0) return;
      const level = levelOf(page);
      grow(level);
      held[level]++;
      heldKeys[key] = 1;
      heldCount++;
    },
    remove(page: PageRec) {
      const key = keyOf(page);
      if (bootstrapKey[key] || refs[key] <= 0 || --refs[key] > 0) return;
      held[levelOf(page)]--;
      heldKeys[key] = 0;
      heldCount--;
    },
    rank(room: number, cut: readonly PageRec[] = []) {
      const records = heldCount;
      counts.set(held);
      if (records <= room) return records;
      if (keys.length < room) {
        keys = new Int32Array(room);
        ranked.length = room;
      }
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

/** The prefix summarized by what both versions must yield identically: as many pages taken
 *  at each level. A level's internal order is no longer a promise. */
export function levelHistogram(keys: Int32Array, length: number, levelOfKey: Int32Array) {
  const levels: number[] = [];
  for (let i = 0; i < length; i++) {
    const level = levelOfKey[keys[i]];
    levels[level] = (levels[level] ?? 0) + 1;
  }
  for (let i = 0; i < levels.length; i++) levels[i] = levels[i] ?? 0;
  return levels;
}
