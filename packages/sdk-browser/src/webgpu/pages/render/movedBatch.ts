import { moveRootRows } from './movedRoot.ts'
import { deriveRootRows } from '../../../placement/rowWords.ts'
import { appendRootsUnder } from './movedNode.ts'
import { chainShown } from '../../../host/world/rooted.ts'
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/**
 * What the nodes of one move call leave to do, done once for the call: the moved roots' worlds
 * taken and their rows alone rewritten (`movedRoot.ts`) — their box and stretch follow when read
 * (`rootWorld.ts`) —, each root's motion told to the shadow mobility, and the scene revision bumped
 * once. The shadow pages a root left and entered are the rows pass's to stale, row by row, from the
 * world it derives the rows from (`../../../placement/rowCastWgsl.ts`): the CPU declares no box. A
 * root under two moved nodes is passed once, at the pose it ends at; what a root does here depends
 * on it alone, so the roots are passed in any order.
 *
 * No allocation per call: every list is filled up to a count and never truncated — a truncated
 * array drops its storage — so it grows only for a call larger than any before it.
 */

/** Ranks of the roots under each moved node, node after node; the distinct ranks of several nodes. */
const movedList: number[] = [],
  distinct: number[] = []
let movedCount = 0,
  nodeCount = 0,
  distinctCount = 0
/** Per root: 1 once it is listed in `distinct`. */
let listedRoots = new Uint8Array(0)

/**
 * The nodes `nodes` were written — an engine move's, the host's the scene watch heard —, before
 * the transform tree's pass takes them: the roots whose mesh lies in each one's subtree, walked
 * once in the tree (`appendRootsUnder`). A node under another written node moves with it, in its
 * turn, never again (`chainShown`). The work follows the nodes written, never the scene's roots.
 */
export function noteMoved(rt: WebgpuPagesRuntime, nodes: ReadonlySet<Object3D>) {
  const scene = rt.setup.source
  for (const node of nodes) {
    if (chainShown(node, scene, nodes) === null) continue
    movedCount = appendRootsUnder(rt.layout, node, movedList, movedCount)
    nodeCount++
  }
}

/** The pass over the roots the noted nodes moved; nothing if none. The counts are reset even when
 *  the pass throws: a later call never inherits stale ranks. `announce`: an engine move bumps the
 *  scene revision itself; a host write's already did. */
export function finishMoves(rt: WebgpuPagesRuntime, announce = true) {
  if (!nodeCount) return
  try {
    passMoves(rt, announce)
  } finally {
    for (let k = 0; k < distinctCount; k++) listedRoots[distinct[k]] = 0
    movedCount = nodeCount = distinctCount = 0
  }
}

function passMoves(rt: WebgpuPagesRuntime, announce: boolean) {
  const { lights, run, layout } = rt,
    roots = layout.selectionRoots
  if (listedRoots.length < roots.length) listedRoots = new Uint8Array(roots.length)
  // One node's ranks are already distinct (`appendRootsUnder`); several nodes' may overlap.
  let ranks = movedList,
    count = movedCount
  if (nodeCount > 1) {
    for (let j = 0; j < movedCount; j++) {
      const i = movedList[j]
      if (listedRoots[i]) continue
      listedRoots[i] = 1
      distinct[distinctCount++] = i
    }
    ranks = distinct
    count = distinctCount
  }
  for (let k = 0; k < count; k++) {
    const i = ranks[k],
      root = roots[i]
    // A row root moves with its row, which its owner writes (`followPlacementRows`).
    if (root.placement) continue
    moveRootRows(rt, root, i)
    // A node moved: each root under it moved, at the pose it now reads; its first move takes it
    // out of the static slice (`../../shadow/mobility.ts`), which its rows' change then stales.
    if (!root.worldBox) continue
    lights.mobility.move(i, root.world.elements, true)
    deriveRootRows(rt, i)
  }
  // Origin of the scene change: these subtrees' world matrices have just been rewritten. Only
  // poses moved — no node entered or left the scene — so the watched set is left as it stands
  // instead of being rebuilt from a walk of the source graph on the next image; the hierarchy
  // already carries this revision's matrices: the next image does not climb it.
  if (announce) {
    run.gate.movedInPlace()
    run.gate.noteWorldsUpdated()
  }
}
