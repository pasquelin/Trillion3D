import type { PageRec } from '../selection/selection.ts';
import type { ClusterRoot } from '../selection/types.ts';
import type { IdDelta } from '../../webgpu/cut/delta.ts';
import { createSparseInts, grown } from './sparseInts.ts';

/**
 * What the cache must hold for the cut to draw what it asks for: whole groups, closed upward.
 *
 * The cut rule reads residency by group (`./readiness.ts`): a cluster is drawn once
 * every cluster of its group is resident and so, up to the roots, is every group that replaces
 * its outputs. A cut that asked only for the clusters it draws would leave the group-mates a view
 * never keeps — past the frustum, behind the cone — outside the cache, and its surface drawn one
 * level coarser forever. So each page the cut names brings its group and the groups above it.
 *
 * Held by reference count per group, so a group many cut pages share is walked once: holding a
 * group holds its members and, for each of its outputs, the output's own group — or the output
 * itself when nothing replaces it. The difference it publishes is the one of the pages held, in
 * the same shape as the cut's (`IdDelta`), so every reader downstream is unchanged.
 */
export type GroupClosure = ReturnType<typeof createGroupClosure>;

/**
 * Every table is sparse (`./sparseInts.ts`): it holds the groups and pages the cut closes over,
 * never the placements' catalogue (#483 rule 6). A placement's pages are packed contiguously from
 * its first page's `packedIndex`, and a group is keyed by its first member's packed id, which no
 * other group shares.
 */
export function createGroupClosure(
  roots: readonly ClusterRoot<PageRec>[],
  /** The packed catalogue `apply` and `closeOver` read ids in; `closeOverRecords` needs none. */
  packedPages: readonly PageRec[] = [],
) {
  /** Holders per group and per page, and the pages whose count moved in this difference with
   *  whether each was held before it (1 no, 2 yes). */
  const heldGroups = createSparseInts(),
    heldPages = createSparseInts(),
    seen = createSparseInts(),
    touched: number[] = [];
  const delta = {
    entered: new Int32Array(8),
    exited: new Int32Array(8),
    enteredCount: 0,
    exitedCount: 0,
    has: (id: number) => heldPages.get(id) > 0,
  };
  /** Groups one `closeOver` walk reached. */
  const walked = createSparseInts();
  let /** What a walk does: counts `step` on what it reaches, or hands each page to `visitor`. */
    step = 0,
    visitor: ((id: number, rec: PageRec) => void) | undefined;
  const baseOf = (r: number) => roots[r].pages[0]?.packedIndex ?? 0;
  const touchId = (id: number, rec: PageRec) => {
    if (visitor) return visitor(id, rec);
    if (!seen.get(id)) {
      seen.set(id, heldPages.get(id) > 0 ? 2 : 1);
      touched.push(id);
    }
    heldPages.add(id, step);
  };
  const touch = (r: number, page: number) => touchId(baseOf(r) + page, roots[r].pages[page]);
  /** Group `g` of placement `r` and what it holds: its members, and each output's own group — the
   *  output itself when nothing replaces it. A counted group is walked when it is first held or
   *  last released; a visited one once per walk. */
  const reach = (r: number, g: number) => {
    const s = roots[r].structure!,
      key = baseOf(r) + s.children[s.childOffsets[g]];
    if (visitor) {
      if (walked.set(key, 1)) return;
    } else {
      const count = heldGroups.add(key, step);
      if (count - step > 0 === count > 0) return;
    }
    for (let i = s.childOffsets[g]; i < s.childOffsets[g + 1]; i++) touch(r, s.children[i]);
    for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++) {
      const output = s.outputs[i],
        owner = s.owners[output];
      if (owner >= 0) reach(r, owner);
      else touch(r, output);
    }
  };
  /** A page enters through its own group, or alone when nothing replaces it. */
  const enterAs = (id: number, rec: PageRec) => {
    const r = rec.placementIndex ?? -1,
      owner = r >= 0 ? (roots[r]?.structure?.owners[id - baseOf(r)] ?? -1) : -1;
    if (owner >= 0) reach(r, owner);
    else touchId(id, rec);
  };
  const enter = (id: number) => {
    const rec = packedPages[id];
    if (rec) enterAs(id, rec);
  };
  const endWalk = () => {
    visitor = undefined;
    walked.clear();
  };
  return {
    delta: delta as IdDelta,
    /** Bytes of the tables above, sized by what the cut closes over: the CPU budget holds them on
     *  WebGPU (`../../residency/memoryBudget.ts`). */
    get hostBytes() {
      return (
        heldGroups.byteLength +
        heldPages.byteLength +
        seen.byteLength +
        walked.byteLength +
        delta.entered.byteLength +
        delta.exited.byteLength
      );
    },
    /** Visits every page `ids` close over, themselves included, each group once per call:
     *  what a list rebuilt whole asks for (`../../webgpu/residency/lowerTier.ts`). */
    closeOver(ids: ArrayLike<number>, visit: (id: number, rec: PageRec) => void) {
      visitor = visit;
      for (let i = 0; i < ids.length; i++) enter(ids[i]);
      endWalk();
    },
    /** The same, for records carrying their placement and packed index, without a catalogue. */
    closeOverRecords(recs: readonly PageRec[], visit: (id: number, rec: PageRec) => void) {
      visitor = visit;
      for (const rec of recs) if (rec.packedIndex !== undefined) enterAs(rec.packedIndex, rec);
      endWalk();
    },
    /** Turns the cut's difference into the difference of the pages it closes over. */
    apply(cut: IdDelta) {
      // Entries first: a group one page leaves and another joins is never let go in between.
      step = 1;
      for (let i = 0; i < cut.enteredCount; i++) enter(cut.entered[i]);
      step = -1;
      for (let i = 0; i < cut.exitedCount; i++) enter(cut.exited[i]);
      if (delta.entered.length < touched.length)
        delta.entered = grown(delta.entered, touched.length);
      if (delta.exited.length < touched.length) delta.exited = grown(delta.exited, touched.length);
      delta.enteredCount = delta.exitedCount = 0;
      for (const id of touched) {
        const now = heldPages.get(id) > 0,
          before = seen.get(id) === 2;
        if (now && !before) delta.entered[delta.enteredCount++] = id;
        else if (!now && before) delta.exited[delta.exitedCount++] = id;
      }
      seen.clear();
      touched.length = 0;
    },
  };
}
