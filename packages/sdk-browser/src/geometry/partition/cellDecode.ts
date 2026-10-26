/**
 * A PARTITION'S CELL FILE, READ OFF THE MAIN THREAD (#575). The page worker pool's `cells` task
 * (`../work/task.ts`) parses the file, refuses one of another version and composes the
 * local matrix of each node as the engine composes a host node's, and reads the track of the
 * scene's animation banks each node plays, whether it is drawn from its parent's own host
 * mesh, the source node it draws and the distances it is drawn at; the main thread only copies
 * those onto rows
 * (`cells.ts`, `placements.ts`). Without a
 * worker, the same function runs on the main thread (`../work/host.ts`).
 */
import { MATRIX_VALUES } from '../../../../math/src/batch/strides.ts'
import type { PageTaskDone } from '../../../../sdk-core/src/page/taskContracts.ts'
import { assertCellNodes, type CellNode } from '../../../../sdk-core/src/scene/core/tableCell.ts'
import { parseSourceRank } from '../../../../sdk-core/src/scene/core/sourceRank.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { pose } from '../../scene/host/prepared/nodes.ts'
import { composeMatrix4 } from '../../../../math/src/matrix/matrix4Compose.ts'
import { DRAW_DISTANCE_STRIDE, writeDrawDistanceAt } from '../dag/drawDistance.ts'
import type { RootParent } from '../selection/types.ts'

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

/** A node's far-shadow test as its byte in `CellRows.farShadowTests`: 0 for none named, 1 for
 *  `true`, 2 for `false`. */
const farTestByte = (test: boolean | undefined) => (test === undefined ? 0 : test ? 1 : 2)

/** The far-shadow test a byte of `CellRows.farShadowTests` names; none for 0 or no byte. */
export const farTestOf = (byte: number | undefined) =>
  byte === 1 ? true : byte === 2 ? false : undefined

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
    sourceNodes = new Uint32Array(nodes.length),
    drawDistances = new Float32Array(DRAW_DISTANCE_STRIDE * nodes.length),
    farFields = new Uint8Array(nodes.length),
    castFarShadows = new Uint8Array(nodes.length),
    farShadowTests = new Uint8Array(nodes.length),
    rootParents: number[] = []
  nodes.forEach((node, at) => {
    ranks[2 * at] = node.parent ?? -1
    ranks[2 * at + 1] = node.mesh
    rowLocal(node, locals.subarray(MATRIX_VALUES * at, MATRIX_VALUES * (at + 1)))
    tracks[at] = node.track ?? -1
    sources[at] = node.source ? 1 : 0
    // Checked by `assertCellNodes`.
    sourceNodes[at] = parseSourceRank(node.sourceNode)!
    writeDrawDistanceAt(drawDistances, at, node.drawDistance)
    farFields[at] = node.farField ? 1 : 0
    castFarShadows[at] = node.castFarShadow ? 1 : 0
    farShadowTests[at] = farTestByte(node.farShadowTest)
    node.rootParents?.forEach((parent, primitive) => {
      if (parent) rootParents.push(at, primitive, ...parent)
    })
  })
  return {
    nodes: nodes.length,
    ranks: ranks.buffer,
    locals: locals.buffer,
    tracks: tracks.buffer,
    sources: sources.buffer,
    sourceNodes: sourceNodes.buffer,
    drawDistances: drawDistances.buffer,
    farFields: farFields.buffer,
    castFarShadows: castFarShadows.buffer,
    farShadowTests: farShadowTests.buffer,
    rootParents: Float32Array.from(rootParents).buffer,
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
  /** Per node, the rank of the source node it draws (`CellNode.sourceNode`); absent for the rows
   *  of an HLOD cell's actor, which draw no source node of their own. */
  sourceNodes?: Uint32Array
  /** Per node, the distances it is drawn at (`CellNode.drawDistance`, `DRAW_DISTANCE_STRIDE`
   *  floats each), all 0 for none. */
  drawDistances: Float32Array
  /** Per node, 1 when a view's primed depth draws it (`CellNode.farField`); absent for none. */
  farFields?: Uint8Array
  /** Per node, 1 when it casts far shadows (`CellNode.castFarShadow`); absent for none. */
  castFarShadows?: Uint8Array
  /** Per node, 1 when a sun's far-shadow test reaches it, 2 when it never does
   *  (`CellNode.farShadowTest`), 0 for none named; absent for none. */
  farShadowTests?: Uint8Array
  /** The groups that replace the roots of the instances of assemblies the cell holds
   *  (`CellNode.rootParents`): seven floats an entry — the node, the primitive of its mesh, the
   *  error, the ball's centre and radius —; absent for none. */
  rootParents?: Float32Array
}

/** Floats of an entry of `CellRows.rootParents`. */
const ROOT_PARENT_ENTRY = 7

/** The groups the instances of assemblies of `rows` have above their roots, by node, then by
 *  primitive of its mesh. */
export function rootParentsByNode({ rootParents }: CellRows) {
  const byNode = new Map<number, Map<number, RootParent>>()
  for (let at = 0; rootParents && at < rootParents.length; at += ROOT_PARENT_ENTRY) {
    const [node, primitive, error, x, y, z, radius] = rootParents.subarray(
      at,
      at + ROOT_PARENT_ENTRY,
    )
    const own = byNode.get(node) ?? new Map<number, RootParent>()
    own.set(primitive, { error, sphere: [x, y, z, radius] })
    byNode.set(node, own)
  }
  return byNode
}

/** The columns of a cell as the pool answers them: the buffers the worker's transfer
 *  (`work/task.ts`) hands over. */
export const CELL_COLUMNS = [
  'ranks',
  'locals',
  'tracks',
  'sources',
  'sourceNodes',
  'drawDistances',
  'farFields',
  'castFarShadows',
  'farShadowTests',
  'rootParents',
] as const

/** The rows of a decoded cell. */
export const cellRows = (payload: CellPayload): CellRows => ({
  nodes: payload.nodes,
  ranks: new Int32Array(payload.ranks),
  locals: new Float64Array(payload.locals),
  tracks: new Int32Array(payload.tracks),
  sources: new Uint8Array(payload.sources),
  sourceNodes: new Uint32Array(payload.sourceNodes),
  drawDistances: new Float32Array(payload.drawDistances),
  farFields: new Uint8Array(payload.farFields),
  castFarShadows: new Uint8Array(payload.castFarShadows),
  farShadowTests: new Uint8Array(payload.farShadowTests),
  rootParents: new Float32Array(payload.rootParents),
})
