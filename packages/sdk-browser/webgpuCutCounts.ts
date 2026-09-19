import type { PageRec } from './pageSelection.ts';
import type { CutDelta } from './webgpuCutDelta.ts';

export type CutCounts = ReturnType<typeof createCutCounts>;

/**
 * Triangle totals of the cut shown list, held from frame to frame instead of being resommed.
 *
 * `selectedTriangles` is the whole drawable cut, `uncoveredTriangles` the hole — a cluster the
 * kernel wants to draw whose residency row or bytes are missing —, `drawnTriangles` what remains
 * and goes to draw, `transparentTriangles` the blend share. Their relation stays
 * `selected − drawn − uncovered = 0`, and that is the only honest way to state the hole.
 *
 * They used to be resommed over the whole cut at every adoption, including when the frame reread
 * the shown list it already held. Here they move only by what moves: the pages the difference
 * names, and those whose coverage just flipped — bytes received or lost, residency row taken or
 * released. A frame that enters and exits no page touches no counter.
 *
 * Membership is not stored a second time here: it is the difference's, which already holds it
 * and to which these totals are attached once and for all.
 */
export function createCutCounts(
  packedPages: readonly PageRec[],
  residentOffsetWords: Int32Array,
  delta: CutDelta,
) {
  const capacity = Math.max(1, packedPages.length);
  /** What was counted as a hole: what was added is exactly what will be removed. */
  const holed = new Uint8Array(capacity);
  const totals = {
    selectedTriangles: 0,
    drawnTriangles: 0,
    uncoveredTriangles: 0,
    transparentTriangles: 0,
  };
  let selected = 0,
    uncovered = 0,
    transparent = 0;
  const publish = () => {
    totals.selectedTriangles = selected;
    totals.uncoveredTriangles = uncovered;
    // One subtraction outside the loop, on two counters already held.
    totals.drawnTriangles = selected - uncovered;
    totals.transparentTriangles = transparent;
  };
  /** True when the page is missing from the frame: no residency row, or no bytes. */
  const holes = (id: number, rec: PageRec) => residentOffsetWords[id] < 0 || !rec.array;
  return {
    totals,
    /** The difference that has just been applied: exits first, entries next. */
    apply() {
      const exits = delta.exited,
        entries = delta.entered;
      for (let i = 0; i < delta.exitedCount; i++) {
        const id = exits[i],
          rec = packedPages[id];
        selected -= rec.triangles;
        if (rec.transparent) transparent -= rec.triangles;
        if (holed[id]) {
          uncovered -= rec.triangles;
          holed[id] = 0;
        }
      }
      for (let i = 0; i < delta.enteredCount; i++) {
        const id = entries[i],
          rec = packedPages[id];
        selected += rec.triangles;
        if (rec.transparent) transparent += rec.triangles;
        if (holes(id, rec)) {
          uncovered += rec.triangles;
          holed[id] = 1;
        }
      }
      publish();
      return totals;
    },
    /** A page's coverage has just moved; outside the cut, it weighs on nothing. */
    touch(id: number) {
      if (!delta.has(id)) return;
      const rec = packedPages[id],
        now = holes(id, rec) ? 1 : 0;
      if (now === holed[id]) return;
      holed[id] = now;
      uncovered += now ? rec.triangles : -rec.triangles;
      publish();
    },
  };
}
