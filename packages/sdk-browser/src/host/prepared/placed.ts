/**
 * The host meshes a partitioned scene draws its cells' nodes with (#404): for each mesh the cells
 * place, one copy of each of its primitive meshes, hung on the scene root and placed by rows — its
 * association carries the instance buffer the cells write (`../../scene/partition/rows.ts`), so
 * its own pose is never read. It bounds itself by the box around every cell: the framing and the
 * bounds of a loaded model take the whole world, whichever cells are read.
 */
import { numbered } from '../graph/serial.ts';
import type { TablePartition } from '../../../../sdk-core/src/scene/core/tablePartition.ts';
import type { HostBox, HostMesh } from '../resources.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { placedMesh, type PlacedMesh, type RowLink } from '../../scene/partition/rows.ts';

/** The placed mesh of each mesh rank the cells place, its host meshes added under `scene` and
 *  their links recorded in `ranks`; `parts` gives the primitive meshes built for a rank. */
export function placedMeshes(
  partition: TablePartition | null,
  scene: Object3D,
  ranks: Map<Object3D, RowLink>,
  parts: (rank: number) => readonly Object3D[],
) {
  const placed = new Map<number, PlacedMesh>();
  if (!partition) return placed;
  const [minX, minY, minZ, maxX, maxY, maxZ] = partition.bounds;
  const box: HostBox = { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
  for (const rank of partition.meshes) {
    const nodes = parts(rank).map((part) => {
      const mesh = Object.assign(numbered(part.clone()) as HostMesh, { boundingBox: box });
      // A cell places only shown nodes; the part may be a hidden core node's own mesh (#519).
      mesh.visible = true;
      scene.add(mesh);
      return mesh;
    });
    const links = nodes.map((_mesh, primitives): RowLink => ({ meshes: rank, primitives }));
    nodes.forEach((mesh, at) => ranks.set(mesh, links[at]));
    placed.set(rank, placedMesh(links, nodes));
  }
  return placed;
}
