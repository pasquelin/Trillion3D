import type { ClusterRoot } from '../page/selection/types.ts';
import type { PageRec } from '../page/selection/selection.ts';
import { createDeformationFrame, type DeformedMesh } from './frame.ts';
import { placementDeformation } from './placementSource.ts';
import { deformedOf } from './source.ts';
import type { HostWorldPlacements } from '../host/world/placements.ts';

/**
 * A session's GPU deformation (#357): one record per deformed root of its cut (`frame.ts`), the
 * block of records placed in the float pool the page passes bind (`place`), and the word a row
 * carries to name its root's record (`PageInfo.deform`). A root joining the session later has
 * none: the session that draws a deformed root is opened with it.
 */
export function createSessionDeformation(
  roots: readonly ClusterRoot<PageRec>[],
  worlds: Pick<HostWorldPlacements, 'of'>,
) {
  const frame = createDeformationFrame(
    roots.map((root) => {
      const source = root.pages[0]?.sourceMesh as DeformedMesh | undefined;
      if (!source) return null;
      const { mesh, models } = placementDeformation(root.placement, source);
      const deformed = deformedOf(mesh, root, root.world, models);
      // Imported bones live in the indexed host tree; page-authored bones use the world's own tree.
      if (deformed && mesh.skeleton && !root.placement?.rows.sources)
        deformed.boneWorlds = mesh.skeleton.bones.map(worlds.of);
      return deformed;
    }),
  );
  let base = 0;
  /** Each root's placement rank by the world it reads: what a transparent item knows it by. */
  const byWorld = new Map(roots.map((root, placement) => [root.world, placement] as const));
  return {
    frame,
    /** Whether any root deforms. */
    get any() {
      return frame.bases.some((b) => b > 0);
    },
    /** Floats the float pool keeps after its vertices for the block. */
    floats: frame.block.length,
    /** The block lies from float `offset` of the pool. */
    place(offset: number) {
      base = offset;
    },
    /** The block's first float in the pool. */
    get base() {
      return base;
    },
    /** What a row of `placement` carries: its record's first float in the pool plus one, zero
     *  when it has none. */
    rowWord(placement: number | undefined) {
      const at = placement === undefined ? 0 : (frame.bases[placement] ?? 0);
      return at ? base + at : 0;
    },
    /** `rowWord` of the root placed by `world`: a transparent item's. */
    wordOfWorld(world: object) {
      return this.rowWord(byWorld.get(world as ClusterRoot<PageRec>['world']));
    },
  };
}

export type SessionDeformation = ReturnType<typeof createSessionDeformation>;
