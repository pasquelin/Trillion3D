import type { PageRec, ClusterRoot } from '../pageSelectionTypes.ts';
import type { WebglFrameGate } from '../webglFrameGate.ts';
import { followPlacementRows } from './placementUpdate.ts';
import type { PlacementRows } from './placementRows.ts';

/** Addresses already counted, reused across calls: nothing is allocated to count a frame. */
const counted = new Set<string>();

/**
 * The host meshes `recs` hang on the WebGL2 path's display graph, which its page ceiling bounds:
 * one per record drawn on its own, one per PAGE for the records rows place — they are drawn
 * instanced (`webglPageBatches.ts`), and ten thousand placements of a page are one mesh.
 */
export function attachedPages(recs: readonly PageRec[]) {
  counted.clear();
  let own = 0;
  for (const rec of recs)
    if (rec.placement) counted.add(rec.url);
    else own++;
  return own + counted.size;
}

/** `updatePlacements` of the WebGL2 path: the roots follow their rows, and a frame that moved
 *  something is not held. The instanced pages read the rows at the next frame's sync. */
export function autonomousPlacements(roots: readonly ClusterRoot<PageRec>[], gate: WebglFrameGate) {
  return (rows: PlacementRows, from: number, to: number) => {
    if (followPlacementRows(roots, rows, from, to)) gate.sceneMoved();
  };
}
