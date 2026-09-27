import type { PageRec } from '../../page/selection/selection.ts';
import type { collectClusterPages } from '../../page/selection/collect.ts';
import { attachedPages } from '../../placement/autonomousPlacements.ts';
import { blendMoves, type AlphaChange } from '../../placement/backendSceneUpdates.ts';

/** The host page ceiling's one check: the display meshes the root cover would hang, refused by
 *  name past it — at open, at an instance, at a class change. */
export function checkRootBudget(meshes: number, hostCeiling: number) {
  if (meshes > hostCeiling) throw new Error('AUTONOMOUS_ROOT_BUDGET');
}

type Cover = {
  allPages: PageRec[];
  bootstrap: PageRec[];
  hostCeiling: number;
  reassignBlend: ReturnType<typeof collectClusterPages>['reassignBlend'];
};

/**
 * Why a material moved into or out of blended would take the cover past the host ceiling, before
 * any write (#846): records placed by rows are one instanced mesh while opaque, one mesh a row
 * once blended. The move is tried on the records, counted as the open counts it, and undone.
 */
export function blendCeilingRefusal(cover: Cover, alpha: AlphaChange) {
  const { allPages, bootstrap, hostCeiling, reassignBlend } = cover;
  if (hostCeiling === Infinity || !blendMoves(alpha)) return undefined;
  const held = allPages.map((rec) => rec.transparent);
  try {
    reassignBlend(allPages, alpha, true);
    checkRootBudget(attachedPages(bootstrap), hostCeiling);
    return undefined;
  } catch (error) {
    return `${(error as Error).message}: the cover would hang more meshes than the host allows`;
  } finally {
    allPages.forEach((rec, i) => (rec.transparent = held[i]));
  }
}
