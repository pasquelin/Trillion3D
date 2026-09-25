import type { PageRec } from '../../page/selection/selection.ts';
import type { ClusterRoot } from '../../page/selection/types.ts';
import type { IdDelta } from './delta.ts';

/**
 * What the cache must hold for the cut to draw what it asks for: whole groups, closed upward.
 *
 * The cut rule reads residency by group (`../../page/cut/readiness.ts`): a cluster is drawn once
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

export function createGroupClosure(
  roots: readonly ClusterRoot<PageRec>[],
  packedPages: readonly PageRec[],
) {
  const pageBase = new Int32Array(Math.max(1, roots.length)),
    groupBase = new Int32Array(Math.max(1, roots.length));
  let pages = 0,
    groups = 0;
  roots.forEach((root, r) => {
    pageBase[r] = pages;
    groupBase[r] = groups;
    pages += root.pages.length;
    groups += root.structure?.groupCount ?? 0;
  });
  const heldGroups = new Int32Array(Math.max(1, groups)),
    heldPages = new Int32Array(Math.max(1, packedPages.length)),
    /** Pages whose count moved in this difference, and whether each was held before it. */
    touched: number[] = [],
    before = new Uint8Array(Math.max(1, packedPages.length)),
    seen = new Uint8Array(Math.max(1, packedPages.length));
  const capacity = Math.max(1, packedPages.length);
  const delta = {
    entered: new Int32Array(capacity),
    exited: new Int32Array(capacity),
    enteredCount: 0,
    exitedCount: 0,
    has: (id: number) => heldPages[id] > 0,
  };
  /** Group stamps of one `closeOver` walk. */
  const walked = new Uint32Array(Math.max(1, groups));
  let walk = 0,
    /** What a walk does: counts `step` on what it reaches, or hands each page to `visitor`. */
    step = 0,
    visitor: ((id: number) => void) | undefined;
  const touch = (id: number) => {
    if (visitor) return visitor(id);
    if (!seen[id]) {
      seen[id] = 1;
      before[id] = heldPages[id] > 0 ? 1 : 0;
      touched.push(id);
    }
    heldPages[id] += step;
  };
  /** Group `g` of placement `r` and what it holds: its members, and each output's own group — the
   *  output itself when nothing replaces it. A counted group is walked when it is first held or
   *  last released; a visited one once per walk. */
  const reach = (r: number, g: number) => {
    const at = groupBase[r] + g;
    if (visitor) {
      if (walked[at] === walk) return;
      walked[at] = walk;
    } else {
      const was = heldGroups[at] > 0;
      heldGroups[at] += step;
      if (was === heldGroups[at] > 0) return;
    }
    const s = roots[r].structure!,
      base = pageBase[r];
    for (let i = s.childOffsets[g]; i < s.childOffsets[g + 1]; i++) touch(base + s.children[i]);
    for (let i = s.outputOffsets[g]; i < s.outputOffsets[g + 1]; i++) {
      const output = s.outputs[i],
        owner = s.owners[output];
      if (owner >= 0) reach(r, owner);
      else touch(base + output);
    }
  };
  /** Packed page `id` enters through its own group, or alone when nothing replaces it. */
  const enter = (id: number) => {
    const r = packedPages[id]?.placementIndex ?? -1,
      structure = roots[r]?.structure,
      owner = structure ? structure.owners[id - pageBase[r]] : -1;
    if (owner >= 0) reach(r, owner);
    else touch(id);
  };
  return {
    delta: delta as IdDelta,
    /** Visits every page `ids` close over, themselves included, each group once per call:
     *  what a list rebuilt whole asks for (`../residency/shadowTier.ts`). */
    closeOver(ids: ArrayLike<number>, visit: (id: number) => void) {
      walk++;
      visitor = visit;
      for (let i = 0; i < ids.length; i++) enter(ids[i]);
      visitor = undefined;
    },
    /** Turns the cut's difference into the difference of the pages it closes over. */
    apply(cut: IdDelta) {
      // Entries first: a group one page leaves and another joins is never let go in between.
      step = 1;
      for (let i = 0; i < cut.enteredCount; i++) enter(cut.entered[i]);
      step = -1;
      for (let i = 0; i < cut.exitedCount; i++) enter(cut.exited[i]);
      delta.enteredCount = delta.exitedCount = 0;
      for (const id of touched) {
        seen[id] = 0;
        const now = heldPages[id] > 0;
        if (now && !before[id]) delta.entered[delta.enteredCount++] = id;
        else if (!now && before[id]) delta.exited[delta.exitedCount++] = id;
      }
      touched.length = 0;
    },
  };
}
