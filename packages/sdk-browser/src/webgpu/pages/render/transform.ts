import { EngineError, copyMatrix4 } from '../../../../../sdk-core/src/index.ts'
import { rootedUnder } from '../../../host/world/rooted.ts'
import { namedNode, poseNode } from '../../../host/world/moveByName.ts'
import { finishMoves, noteMoved } from './movedBatch.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'

const request = new Float32Array(16)

/** Moves a named node of the prepared scene (R8): the move of `setWebgpuTransforms` on the node the
 *  name index finds (`host/world/nameIndex.ts`). A host moving nodes frame after frame resolves
 *  them once. */
export function setWebgpuTransform(rt: WebgpuPagesRuntime, nodeName: string, matrix: Float32Array) {
  const node = namedNode(rt.setup.source, nodeName, matrix)
  try {
    pose(rt, node, matrix)
  } finally {
    moved(rt)
  }
}

/**
 * Moves nodes the host holds — handles, no name looked up — to column-major WORLD poses, sixteen
 * floats per node in the same order. Each node is posed as its own call would, in
 * order, so a node reads the poses the nodes before it set (`poseNode` reads its chain on demand);
 * one pass of the tree then walks the union of the moved subtrees.
 * Boxes, rows, the scene revision and the shadow boxes follow once for the call (`movedBatch.ts`).
 * A refused node throws once the nodes before it took effect, as the calls one by one would.
 *
 * Nothing is drawn here: the moves take effect at the next image, with no per-image allocation.
 */
export function setWebgpuTransforms(
  rt: WebgpuPagesRuntime,
  nodes: readonly Object3D[],
  matrices: Float32Array,
) {
  if (matrices.length !== nodes.length * 16)
    throw new EngineError('INVALID_TRANSFORM', `${nodes.length} nodes: sixteen floats each`, {
      length: matrices.length,
    })
  try {
    for (let k = 0; k < nodes.length; k++) {
      const node = nodes[k]
      // A handle outlives nothing: a node the host removed from the scene is refused by name.
      if (!rootedUnder(node, rt.setup.source))
        throw new EngineError(
          'UNKNOWN_SCENE_NODE',
          `node ${node.name} missing from the prepared scene`,
          { nodeName: node.name },
        )
      copyMatrix4(request, matrices, 0, k * 16)
      pose(rt, node, request)
    }
  } finally {
    moved(rt)
  }
}

/** The nodes the call moved, each once, with the host's it takes: what its pass notes (`moved`). */
const posed = new Set<Object3D>()

/** One node posed, kept for the call's pass when the move moved it, and its pose taken by the
 *  scene watch as the engine's (`adoptPose`): the next image reads no host write back. */
function pose(rt: WebgpuPagesRuntime, node: Object3D, matrix: Float32Array) {
  if (!poseNode(node, matrix)) return
  rt.run.gate.adoptPose(node)
  posed.add(node)
}

/** The moves of one call taken: the nodes it moved and those the host wrote before it in the same
 *  task (`takeHostMoves`) noted at once (`noteMoved`) — a node under another moved one moving
 *  with it, never twice —, one pass of the transform tree — every matrix it holds, page records,
 *  selection roots, transparent copies, carries the new places, and the pass walks what the writes
 *  changed, nothing else —, then the moved roots' rows and boxes (`finishMoves`). */
function moved(rt: WebgpuPagesRuntime) {
  try {
    // The watch heard the call's own writes too: the host's are the others.
    let host = false
    for (const node of rt.run.gate.takeHostMoves())
      if (!posed.has(node)) {
        host = true
        posed.add(node)
      }
    // The deformation's staleness noted before this pass compared the worlds the host has since
    // rewritten: its next update reads them again, as after a host write the image reads.
    if (host) rt.vis.deformation?.frame.forget()
    noteMoved(rt, posed)
    rt.setup.worlds.refresh()
    finishMoves(rt)
  } finally {
    posed.clear()
  }
}
