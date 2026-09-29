/**
 * THE MESHES OF A PARTITION'S CELLS A SESSION DRAWS, MOUNTED AS THE VIEW READS THEM (#751).
 *
 * A model whose manifest the view holds lists only the primitives of the pages its placed cells
 * hold (`scene/partition/cellPages.ts`): its session opened on those listed then, the other meshes
 * the cells place left out (`collectClusterPages`, `pendingPlaced`). Before each frame, a mesh whose
 * primitive arrived since enters the open session in place (`mountPlacements`), and one whose
 * primitive left with its page leaves it (`unmountPlacements`), each after the last turn of the
 * same mesh. An engine that mounts nothing in place, or a mount that failed, has the owner open
 * the session again (`renew`): the new one opens on what the manifest lists by then.
 */
import type { Primitive } from '../../../../sdk-core/src/index.ts';
import type { ManifestPages } from '../../../../sdk-core/src/manifest/paged.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { BackendContext, RenderBackend } from '../../backend/types.ts';
import type { PlacementMount } from '../../placement/backendSceneUpdates.ts';
import type { PartitionCells } from '../../scene/partition/cells.ts';
import { primitiveFinder } from '../../scene/primitiveLookup.ts';

/** A partition whose manifest the view holds: its pages and the placed mesh of each rank. */
type Held = { pages: ManifestPages; meshes: PartitionCells['meshes'] };
type Inputs = {
  partitions: readonly PartitionCells[];
  /** What the session opened on: its manifest and the association of each host mesh. Absent,
   *  nothing is mounted: the session opened on every mesh the cells place. */
  opened?: Pick<BackendContext, 'metadata' | 'associations'>;
  active: () => RenderBackend;
  renew?: () => void;
};

export function createPartitionMounts({ partitions, opened, active, renew }: Inputs) {
  const held = opened
    ? partitions.flatMap(({ manifest: { pages }, meshes }): Held[] =>
        pages ? [{ pages, meshes }] : [],
      )
    : [];
  if (!opened || !held.length) return { sync() {}, asked: () => [], stale: () => false };
  /** Whether the session draws each host mesh of the cells now, and its last turn. */
  const drawn = new Map<Object3D, boolean>(),
    turns = new Map<Object3D, Promise<void>>();
  /** The manifest's changes each partition was last synced at. */
  const synced = new Map<Held, number>();
  let asked: Promise<void>[] = [],
    atOpen: ReturnType<typeof primitiveFinder> | undefined;
  const openedWith = (node: Object3D) =>
    !!(atOpen ??= primitiveFinder(opened.metadata.primitives))(opened.associations.get(node));
  const turn = (cells: Held, node: Object3D, act: () => unknown) => {
    const last = turns.get(node) ?? Promise.resolve();
    const next = last
      .then(async () => void (await act()))
      .catch(() => {
        drawn.delete(node); // what failed is asked again, by a new session if need be
        synced.delete(cells);
        renew?.();
      });
    turns.set(node, next);
    asked.push(next);
  };
  /** `node` enters the session drawing `primitive`, on the rows its association holds then: grown
   *  meanwhile, they are left again and the next sync mounts it on the new ones. */
  const mount = (cells: Held, node: Object3D, primitive: Primitive) => {
    const backend = active();
    const association = opened.associations.get(node) as PlacementMount['association'];
    const rows = association.placements;
    turn(cells, node, async () => {
      await backend.mountPlacements!({
        node,
        association,
        primitive: { ...primitive, mesh: association.meshes },
      });
      if (association.placements === rows) return;
      backend.unmountPlacements!(rows);
      drawn.set(node, false);
      synced.delete(cells);
    });
  };
  const unmount = (cells: Held, node: Object3D) => {
    const backend = active();
    const association = opened.associations.get(node)!;
    turn(cells, node, () => backend.unmountPlacements!(association.placements!));
  };
  return {
    /** Mounts the meshes whose primitive arrived since the last call, unmounts those whose left. */
    sync() {
      for (const cells of held) {
        const { changes, primitives } = cells.pages;
        if (synced.get(cells) === changes) continue;
        synced.set(cells, changes);
        const primitiveOf = primitiveFinder(primitives);
        const backend = active();
        for (const { links, nodes } of cells.meshes.values())
          links.forEach((link, at) => {
            const node = nodes[at],
              primitive = primitiveOf(link);
            if (!!primitive === (drawn.get(node) ?? openedWith(node))) return;
            if (!backend.mountPlacements || !backend.unmountPlacements) return renew?.();
            drawn.set(node, !!primitive);
            if (primitive) mount(cells, node, primitive);
            else unmount(cells, node);
          });
      }
    },
    /** The turns asked since the last call. */
    asked() {
      const turned = asked;
      asked = [];
      return turned;
    },
    /** Whether a partition's manifest changed since it was last synced. */
    stale: () => held.some((cells) => synced.get(cells) !== cells.pages.changes),
  };
}
