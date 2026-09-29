import type { BlendCopy } from '../cluster/blendCopyContract.ts';
import type { ClusterRoot } from '../page/selection/types.ts';
import type { PageRec } from '../page/selection/selection.ts';
import { createDeformationFrame, type DeformedMesh } from './frame.ts';
import { placementDeformation } from './placementSource.ts';
import { deformedOf } from './source.ts';
import type { HostWorldPlacements } from '../host/world/placements.ts';
import type { MatrixElements } from '../math/matrixElements.ts';

/**
 * A session's GPU deformation (#357): one record per deformed root of its cut (`frame.ts`), the
 * block of records placed in the float pool the page passes bind (`place`), and the word a row
 * carries to name its root's record (`PageInfo.deform`). A root joining the session later has
 * none: the session that draws a deformed root is opened with it.
 */
export function createSessionDeformation(
  roots: readonly ClusterRoot<PageRec>[],
  worlds: Pick<HostWorldPlacements, 'of'>,
  copies: readonly BlendCopy[] = [],
) {
  const capacities: Parameters<typeof placementDeformation>[2] = new Map();
  const deformedEntry = (
    source: DeformedMesh | undefined,
    owner: ClusterRoot<PageRec> | BlendCopy,
    world: MatrixElements,
  ) => {
    if (!source) return null;
    const { mesh, capacity } = placementDeformation(owner.placement, source, capacities);
    const deformed = deformedOf(mesh, owner, world, capacity);
    // Imported bones live in the indexed host tree; page-authored bones use the world's own tree.
    if (deformed && mesh.skeleton && !owner.placement?.rows.sources)
      deformed.boneWorlds = mesh.skeleton.bones.map(worlds.of);
    return deformed;
  };
  const frame = createDeformationFrame([
    ...roots.map((root) =>
      deformedEntry(root.pages[0]?.sourceMesh as DeformedMesh | undefined, root, root.world),
    ),
    ...copies.map((copy) => deformedEntry(copy.userData.sourceMesh, copy, copy.matrix)),
  ]);
  let base = 0;
  /** Each root's placement rank by the world it reads: what a transparent item knows it by. */
  const byWorld = new Map<object, number>(roots.map((root, placement) => [root.world, placement]));
  copies.forEach((copy, i) => byWorld.set(copy.matrix, roots.length + i));
  const rankOf = (world: object) => byWorld.get(world) ?? -1;
  return {
    frame,
    changedOfWorld(world: object) {
      return frame.dirty[rankOf(world)] === 1;
    },
    reachOfWorld(world: object) {
      return frame.reach[rankOf(world)] ?? 0;
    },
    /** Whether any root deforms. */
    any: frame.bases.some((b) => b > 0),
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
      return this.rowWord(byWorld.get(world));
    },
  };
}

export type SessionDeformation = ReturnType<typeof createSessionDeformation>;
