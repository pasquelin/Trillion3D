/**
 * The host meshes a partitioned scene draws its cells' nodes with (#404): for each mesh the cells
 * place, one copy of each of its primitive meshes, hung on the scene root and placed by rows — its
 * association carries the instance buffer the cells write (`../../scene/partition/rows.ts`), so
 * its own pose is never read. It bounds itself by the box around every cell: the framing and the
 * bounds of a loaded model take the whole world, whichever cells are read.
 */
import type { TablePartition } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import type { GraphMesh } from '../graph/mesh.ts';
import type { GraphNode } from '../graph/node.ts';
import type { HostBox } from '../resources.ts';
import { placedMesh, type PlacedMesh, type RowLink } from '../../scene/partition/rows.ts';

/** The placed mesh of each mesh rank the cells place, its host meshes added under `scene` and
 *  their links recorded in `ranks`; `parts` gives the primitive meshes built for a rank. */
export function placedMeshes(
  partition: TablePartition | null,
  scene: GraphNode,
  ranks: Map<GraphNode, RowLink>,
  parts: (rank: number) => readonly GraphNode[],
) {
  const placed = new Map<number, PlacedMesh>();
  if (!partition) return placed;
  const [minX, minY, minZ, maxX, maxY, maxZ] = partition.bounds;
  const box: HostBox = { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
  for (const rank of partition.meshes) {
    const links = parts(rank).map((part, primitives) => {
      const mesh = Object.assign(part.clone() as GraphMesh, { boundingBox: box });
      const link: RowLink = { meshes: rank, primitives };
      ranks.set(mesh, link);
      scene.add(mesh);
      return link;
    });
    placed.set(rank, placedMesh(links));
  }
  return placed;
}
