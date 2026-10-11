/** Resource meshes share geometry and material; placement rows retain animation owners.
 * Loaded models keep their graph. Resource instances use placement rows, including blends. */
import { Group, type Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { PlacementRows } from '../../placement/rows.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import type { GraphSurface } from '../../host/graph/surface.ts'
import type { Cut } from './worldCuts.ts'
import type { PosedTwin } from './worldPoses.ts'

/** What the mirror is built from: the resources placed by rows, the models drawn whole, and the
 *  mesh rank each geometry resource was given in the session's manifest. */
type Placed = {
  cut: Cut
  /** The surface its rows are worn as (`Batch.surface`). */
  surface: GraphSurface
  rows: PlacementRows
  name: string
}
type MirrorInput = {
  placed: readonly Placed[]
  models: readonly { node: Object3D; graph: Object3D }[]
  rankOf: (cut: Cut) => number
}

/** The host graph of a world's session, and the twins the world poses before a frame. */
export function buildWorldMirror(input: MirrorInput) {
  const root = new Group()
  const twins = new Map<Object3D, PosedTwin>()
  const associations = new Map<
    Object3D,
    { meshes: number; primitives: number; placements?: PlacementRows }
  >()
  /** Hangs the host mesh of a resource placed by rows; returns it with its association. */
  const place = ({ cut, surface, rows, name }: Placed) => {
    const mesh = new Mesh(cut.geometry, surface)
    mesh.name = name
    const association = { meshes: input.rankOf(cut), primitives: 0, placements: rows }
    associations.set(mesh, association)
    root.add(mesh)
    return { node: mesh, association }
  }
  input.placed.forEach(place)
  for (const { node, graph } of input.models) {
    const twin = new Group()
    twin.add(graph)
    twin.name = node.name
    twin.matrixAutoUpdate = false
    twin.matrix.fromArray(node.matrixWorld.elements)
    root.add(twin)
    twins.set(node, twin)
  }
  return { root, twins, associations }
}
