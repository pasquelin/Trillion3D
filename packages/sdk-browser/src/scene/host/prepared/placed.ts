/**
 * The host meshes a partitioned scene draws its cells' nodes with: for each mesh the cells
 * place, one copy of each of its primitive meshes, hung on the scene root and placed by rows — its
 * association carries the instance buffer the cells write (`../../../geometry/partition/rows.ts`), so
 * its own pose is never read. It bounds itself by the box around every cell: the framing and the
 * bounds of a loaded model take the whole world, whichever cells are read.
 *
 * Every row stands in the frame of the scene's graph, as a loaded model's mesh does
 * (`PlacementRows.local`): a palette it reads is read there. The rows carry the scene's animation
 * banks, whose items the instanced skinned objects a cell places play (`PlacementRows.banks`,
 * `tracks`). A row a cell draws from an animated core node's own mesh (`CellNode.source`) reads
 * that node's host mesh as its animation source, row by row (`PlacementRows.sources`), among the
 * streamed nodes' meshes of its primitive (`sourceModels`).
 *
 * One rule ties a streamed node (`TableNode.streamed`) to its cell: each mesh it draws keeps its
 * place in the graph — the clips and the skins name it, its skeleton and its morph weights are
 * what the rows read —, but is drawn by no root of its own. Its association holds one row, never
 * written, so parked, whose animation source is none (`sources: [null]`): no record is made for it.
 * Its main cell's row draws it, while that cell is placed.
 */
import type { PreparedSceneTables } from '../../../../../sdk-core/src/scene/core/tableContracts.ts'
import type { AnimationBanks } from '../../../../../sdk-core/src/scene/core/animationBanks.ts'
import type { Mesh } from '../../../../../sdk-core/src/world/object/mesh.ts'
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import { appendTo } from '../../../../../math/src/sequence/counts.ts'
import { createPlacementRows } from '../../../placement/rows/rows.ts'
import {
  placedMesh,
  type PlacedMesh,
  type RowLink,
  type StreamedMeshes,
} from '../../../geometry/partition/rows.ts'
import { Box3, boxFromFlat } from '../../../../../sdk-core/src/world/math/box3.ts'
import type { PageMesh } from '../../../geometry/pages/pageMesh.ts'

type Inputs = {
  tables: Pick<PreparedSceneTables, 'partition' | 'nodes'>
  /** Where the copies hang. */
  scene: Object3D
  /** Each drawn host mesh's association, which the copies and the streamed meshes join. */
  ranks: Map<Object3D, RowLink>
  /** The primitive meshes built for a mesh rank. */
  parts: (rank: number) => readonly Object3D[]
  /** The scene's animation banks; absent or `null` for a scene with none. */
  banks?: AnimationBanks | null
  /** The meshes each streamed node draws (`streamedMeshes`, `motion.ts`). */
  streamed: StreamedMeshes
}

/** The meshes each streamed node draws parked in `ranks`: drawn by their main cells' rows. */
function parkStreamed(streamed: StreamedMeshes, ranks: Map<Object3D, RowLink>) {
  for (const drawn of streamed.values())
    for (const part of drawn) {
      const placements = createPlacementRows(1)
      placements.sources = [null]
      ranks.set(part, { ...ranks.get(part), placements })
    }
}

/** The placed mesh of each mesh rank the cells place, its host meshes added under `scene` and
 *  their links recorded in `ranks`, the streamed nodes' meshes parked there. */
export function placedMeshes({ tables, scene, ranks, parts, banks, streamed }: Inputs) {
  const placed = new Map<number, PlacedMesh>()
  parkStreamed(streamed, ranks)
  const { partition } = tables
  if (!partition) return placed
  // The streamed nodes' meshes of each mesh rank: the animation sources its rows are drawn from.
  const sourcesOf = new Map<number, (readonly Mesh<object>[])[]>()
  for (const [id, drawn] of streamed) {
    const rank = tables.nodes[id].mesh!
    appendTo(sourcesOf, rank, drawn)
  }
  const box = boxFromFlat(new Box3(), partition.bounds)
  for (const rank of partition.meshes) {
    const built = parts(rank)
    const nodes = built.map((part) => {
      const mesh = Object.assign(part.clone() as PageMesh, { boundingBox: box })
      // A cell places only shown nodes; the part may be a hidden core node's own mesh.
      mesh.visible = true
      scene.add(mesh)
      return mesh
    })
    // A copy of a cloth's primitive is a cloth's too (`RowLink.twoSided`).
    const links = built.map((part, primitives): RowLink => ({
      meshes: rank,
      primitives,
      ...(ranks.get(part)?.twoSided ? { twoSided: true } : {}),
    }))
    nodes.forEach((mesh, at) => ranks.set(mesh, links[at]))
    // Its rows' sources, one column a primitive, when a streamed node draws it.
    const drawers = sourcesOf.get(rank)
    const fed = drawers && { drawers, sources: built.map((): (Mesh<object> | null)[] => []) }
    placed.set(rank, placedMesh(links, nodes, fed?.sources))
    links.forEach((link, at) => {
      const rows = link.placements!
      rows.local = true
      if (banks) rows.banks = banks
      if (!fed) return
      rows.sources = fed.sources[at]
      rows.sourceModels = new Set(fed.drawers.map((drawn) => drawn[at]))
    })
  }
  return placed
}
