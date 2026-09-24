import type { GraphScene } from '../host/graph/scene.ts';
import type { PageRec, ClusterRoot } from '../page/selection/types.ts';
import type { WebglFrameGate } from '../webgl/core/frameGate.ts';
import { followPlacementRows } from './update.ts';
import type { PlacementRows } from './rows.ts';
import { growRowRoots } from './growth.ts';
import type { BlendCopy } from '../cluster/blendCopyContract.ts';
import { followBlendCopies, growBlendCopies } from '../cluster/blendCopyMesh.ts';
import { autonomousBootstrap } from '../backend/autonomous/manifest.ts';
import type { HostMaterials } from '../host/resources.ts';

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
  scene: GraphScene;
  gate: WebglFrameGate;
  /** Tells the instanced pages their rows were written (`webglPageBatches.ts`). */
  rowsWritten: () => void;
  /** Notified when grown rows add records to the root cover. */
  coverChanged: () => void;
};

/** The instance-buffer updates of the WebGL2 path. */
export function autonomousPlacements(env: Placements) {
  const { roots, allPages, bootstrap, byUrl, baseMaterials, blendCopies, scene, gate } = env;
  const { rowsWritten, coverChanged } = env;
  return {
    /** The roots follow their rows, and a frame that moved something is not held. The instanced
     *  pages read the rows at the next frame's sync; the blended copies posed by rows read them in
     *  place and take their flag here (`blendCopyMesh.ts`). */
    updatePlacements(rows: PlacementRows, from: number, to: number) {
      rowsWritten();
      const moved = followPlacementRows(roots, rows, from, to);
      if (followBlendCopies(blendCopies, rows, from, to) || moved) gate.sceneMoved();
    },
    /** The growth contract (`growth.ts`): every table of this path is a list, so the
     *  new rows' roots and pages are appended to them, indexed like the ones collected. */
    growPlacements(from: PlacementRows, to: PlacementRows) {
      for (const { item: root, template } of growRowRoots(roots, from, to)) {
        roots.push(root);
        root.pages.forEach((rec, rank) => {
          allPages.push(rec);
          baseMaterials.set(rec, baseMaterials.get(template.pages[rank])!);
          byUrl.get(rec.url)!.push(rec);
        });
        bootstrap.push(...autonomousBootstrap([root]));
      }
      growBlendCopies(blendCopies, from, to, (copy) => scene.add(copy));
      rowsWritten();
      coverChanged();
      gate.sceneChanged();
    },
  };
}
