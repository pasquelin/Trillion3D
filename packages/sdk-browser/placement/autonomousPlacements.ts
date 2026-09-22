import type { PageRec, ClusterRoot } from '../pageSelectionTypes.ts';
import type { WebglFrameGate } from '../webglFrameGate.ts';
import { followPlacementRows } from './placementUpdate.ts';
import { placedBy, type PlacementRows } from './placementRows.ts';
import { growRowRoots } from './placementGrowth.ts';
import type { BlendCopy } from '../blendCopyContract.ts';
import { growBlendCopies } from '../blendCopyMesh.ts';
import { autonomousBootstrap } from '../autonomousManifest.ts';
import type { HostMaterials } from '../hostResources.ts';
import type { HostDrawScene } from '../hostGraphNodes.ts';

/** Addresses already counted, reused across calls: nothing is allocated to count a frame. */
const counted = new Set<string>();

/**
 * True when a record is drawn instanced with the other rows of its page (`webglPageBatches.ts`).
 * A transparent record placed by a row is drawn on its own, like a blended copy: the host orders
 * blended meshes by depth, never the instances of one draw.
 */
export const drawnInstanced = (rec: PageRec) => !!rec.placement && !rec.transparent;

/**
 * The host meshes `recs` hang on the WebGL2 path's display graph, which its page ceiling bounds:
 * one per record drawn on its own, one per PAGE for the records drawn instanced — ten thousand
 * opaque placements of a page are one mesh.
 */
export function attachedPages(recs: readonly PageRec[]) {
  counted.clear();
  let own = 0;
  for (const rec of recs)
    if (drawnInstanced(rec)) counted.add(rec.url);
    else own++;
  return own + counted.size;
}

type Placements = {
  roots: ClusterRoot<PageRec>[];
  allPages: PageRec[];
  bootstrap: PageRec[];
  byUrl: Map<string, PageRec[]>;
  baseMaterials: Map<PageRec, HostMaterials>;
  /** The host copies of blended and transmissive surfaces, and the graph that shows them. */
  blendCopies: BlendCopy[];
  scene: HostDrawScene;
  gate: WebglFrameGate;
};

/** The instance-buffer updates of the WebGL2 path. */
export function autonomousPlacements(env: Placements) {
  const { roots, allPages, bootstrap, byUrl, baseMaterials, blendCopies, scene, gate } = env;
  return {
    /** The roots follow their rows, and a frame that moved something is not held. The instanced
     *  pages read the rows at the next frame's sync; the blended copies posed by rows read them in
     *  place, flag included (`blendCopyMesh.ts`). */
    updatePlacements(rows: PlacementRows, from: number, to: number) {
      if (followPlacementRows(roots, rows, from, to) || placedBy(blendCopies, rows))
        gate.sceneMoved();
    },
    /** The growth contract (`placementGrowth.ts`): every table of this path is a list, so the
     *  new rows' roots and pages are appended to them, indexed like the ones collected. */
    growPlacements(from: PlacementRows, to: PlacementRows) {
      for (const { root, template } of growRowRoots(roots, from, to)) {
        roots.push(root);
        root.pages.forEach((rec, rank) => {
          allPages.push(rec);
          baseMaterials.set(rec, baseMaterials.get(template.pages[rank])!);
          byUrl.get(rec.url)!.push(rec);
        });
        bootstrap.push(...autonomousBootstrap([root]));
      }
      growBlendCopies(blendCopies, from, to, (copy) => scene.add(copy));
      gate.sceneChanged();
    },
  };
}
