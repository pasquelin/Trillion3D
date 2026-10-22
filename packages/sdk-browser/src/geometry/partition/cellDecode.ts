/**
 * A PARTITION'S CELL FILE, READ OFF THE MAIN THREAD (#575). The page worker pool's `cells` task
 * (`../work/task.ts`) parses the file, refuses one of another version and composes the
 * local matrix of each node as the engine composes a host node's, and reads the track of the
 * scene's animation banks each node plays, whether it is drawn from its parent's own host
 * mesh and the distances it is drawn at; the main thread only copies those onto rows
 * (`cells.ts`, `placements.ts`). Without a
 * worker, the same function runs on the main thread (`../work/host.ts`).
 */
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import type { PageTaskDone } from '../../../../sdk-core/src/page/taskContracts.ts'
import { assertCellNodes, type CellNode } from '../../../../sdk-core/src/scene/core/tableCell.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { pose } from '../../scene/host/prepared/nodes.ts'
import { composeMatrix4 } from '../../../../math/src/matrix/matrix4Compose.ts'

const scratch = new Object3D()

/** The local matrix the engine composes for a cell node's declared pose, as for a host node. */
function rowLocal(node: CellNode, out: Float64Array) {
  scratch.position.set(0, 0, 0)
  scratch.quaternion.set(0, 0, 0, 1)
  scratch.scale.set(1, 1, 1)
  pose(scratch, node)
  const { position, quaternion, scale } = scratch
  return composeMatrix4(out, position.elements, quaternion.elements, scale.elements)
}

/** A cell file as the pool answers it (`PageTaskDone.cells`). */
type CellPayload = NonNullable<PageTaskDone['cells']>

/** The nodes of the cell file `source`, read from `url`, each its parent's and mesh's ranks, its
 *  local matrix, its track, whether it is drawn from its parent's own mesh and the distances it is
 *  drawn at, or the named refusal of a file of another version. */
export function decodeCellFile(source: ArrayBuffer, url = 'a scene cell'): CellPayload {
  const nodes = assertCellNodes(JSON.parse(new TextDecoder().decode(source)), url)
  const ranks = new Int32Array(2 * nodes.length),
    locals = new Float64Array(MATRIX_VALUES * nodes.length),
    tracks = new Int32Array(nodes.length),
    sources = new Uint8Array(nodes.length),
    drawDistances = new Float32Array(2 * nodes.length)
  nodes.forEach((node, at) => {
    ranks[2 * at] = node.parent ?? -1
    ranks[2 * at + 1] = node.mesh
    rowLocal(node, locals.subarray(MATRIX_VALUES * at, MATRIX_VALUES * (at + 1)))
    tracks[at] = node.track ?? -1
    sources[at] = node.source ? 1 : 0
    drawDistances[2 * at] = node.drawDistance?.min ?? 0
    drawDistances[2 * at + 1] = node.drawDistance?.max ?? 0
  })
  return {
    nodes: nodes.length,
    ranks: ranks.buffer,
    locals: locals.buffer,
    tracks: tracks.buffer,
    sources: sources.buffer,
    drawDistances: drawDistances.buffer,
  }
}

/** A decoded cell as its rows are written from it. */
export type CellRows = {
  /** How many nodes the cell holds. */
  nodes: number
  /** Per node, its parent's rank (`-1`: the scene root), then its mesh's. */
  ranks: Int32Array
  /** Per node, its local matrix. */
  locals: Float64Array
  /** Per node, the item of the scene's animation banks it plays (`CellNode.track`), -1 for none. */
  tracks: Int32Array
  /** Per node, 1 when its row is drawn from its parent's own host mesh (`CellNode.source`). */
  sources: Uint8Array
  /** Per node, the nearest then the farthest distance it is drawn at (`CellNode.drawDistance`),
   *  0 and 0 for none. */
  drawDistances: Float32Array
}

/** The rows of a decoded cell. */
export const cellRows = ({
  nodes,
  ranks,
  locals,
  tracks,
  sources,
  drawDistances,
}: CellPayload): CellRows => ({
  nodes,
  ranks: new Int32Array(ranks),
  locals: new Float64Array(locals),
  tracks: new Int32Array(tracks),
  sources: new Uint8Array(sources),
  drawDistances: new Float32Array(drawDistances),
})
