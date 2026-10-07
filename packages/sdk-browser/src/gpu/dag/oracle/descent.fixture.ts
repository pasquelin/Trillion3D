import { DAG_NODE_FLOATS } from '../types.ts'
import { dagNodeFloor, dagNodeVerdict, dagTreeVerdict } from './nodeVerdict.fixture.ts'
import { NODE_FIRST_CHILD, NODE_KIND, NODE_WORLD } from '../nodeLayout.ts'
import { TREE_GROUP, type PlacementTree } from '../placementTree.ts'
import { drawsCard } from '../../../page/cut/select.fixture.ts'
import { thresholdOf, type DagViewFrames } from './math.fixture.ts'

/** A kept leaf reached only by the view ahead (`../shader/aheadWgsl.ts`): its pages are requested
 *  ahead and never drawn. */
export const AHEAD_LEAF = 3

/** One view's node verdict: `-1` rejected — outside, too fine or too coarse —, else its children. */
function keeps(frames: DagViewFrames, nodes: Float32Array, nodeInts: Uint32Array, n: number) {
  if (nodeInts[n * DAG_NODE_FLOATS + NODE_KIND]) return dagTreeVerdict(frames, nodes, nodeInts, n)
  const children = dagNodeVerdict(frames, nodes, nodeInts, n)
  const w = nodeInts[n * DAG_NODE_FLOATS + NODE_WORLD]
  if (children < 0 || dagNodeFloor(frames, nodes, nodeInts, n) > thresholdOf(frames, w)) return -1
  return children
}

type Descended = {
  nodeCount: number
  worldCount: number
  nodes: Float32Array
  rootNodes: Uint32Array
  mark?: Uint32Array
  placementTree?: PlacementTree
  world?: { root: number }
}

/**
 * The first child a kept node opens: a group of the placement tree opens its members, entries past
 * the nodes (`../shader/placementTreeWgsl.ts`); every other node its child nodes.
 */
function firstChild(packed: Descended, nodeInts: Uint32Array, n: number) {
  const base = n * DAG_NODE_FLOATS,
    first = nodeInts[base + NODE_FIRST_CHILD]
  return nodeInts[base + NODE_KIND] === TREE_GROUP ? packed.nodeCount + first : first
}

/** Whether the world DAG draws a placement in its place (`./worldGate.fixture.ts`). */
type Covers = (w: number) => boolean

/** The root a placement entry (`nodeCount + k`, member `k` of the tree's order) opens, or none:
 *  parked, drawn by its card, or drawn by the world DAG. */
function memberRoot(packed: Descended, k: number, covers: Covers) {
  const w = packed.placementTree!.order[k]
  return w === 0xffffffff ? -1 : placementRoot(packed, w, covers)
}

/** The root placement `w` opens, or none: parked, drawn by its card, or by the world DAG. */
function placementRoot(packed: Descended, w: number, covers: Covers) {
  const root = packed.rootNodes[w]
  return root === 0xffffffff || drawsCard(packed.mark?.[w]) || covers(w) ? -1 : root
}

/**
 * Oracle descent: the Node mirror of `../shader/levelWgsl.ts`.
 *
 * A rejected node yields nothing, and a never-reached leaf stays rejected. `nodeFlags` carries
 * each node's verdict — non-zero means « the camera does not descend here » —, and only kept leaves
 * fall back to zero: they alone are what clusters consult next. A node the camera rejects is tried
 * against the view `ahead`, when there is one, and what that view keeps continues under it alone;
 * its kept leaves take `AHEAD_LEAF`. With a placement tree, the descent starts at its top nodes and
 * the world DAG's root, wherever it sits; a placement the world DAG draws in its place (`covers`)
 * opens nothing.
 *
 * Top-down pruning drops a subtree whose error floor is above the threshold, unless the subtree
 * is open — it holds the nearest resident ancestor of something missing (`../shader/floorWgsl.ts`).
 *
 * Split from `oracle.fixture.ts`: it is a whole step, it has its own WGSL mirror.
 */
export function dagOracleDescent(
  packed: Descended,
  frames: DagViewFrames,
  ahead?: DagViewFrames,
  covers: Covers = () => false,
) {
  const { nodes } = packed,
    nodeInts = new Uint32Array(nodes.buffer),
    tree = packed.placementTree
  const nodeFlags = new Uint8Array(Math.max(1, packed.nodeCount)).fill(1)
  /** Pairs: the node, then whether it is the view ahead's alone. */
  const frontier: number[] = []
  // The cut opens no descent on a root its impostor card draws (`drawsCard`, `markOf`).
  const opened = tree ? (packed.world ? [packed.world.root] : []) : packed.rootNodes.keys()
  for (const w of opened)
    if (placementRoot(packed, w, covers) >= 0) frontier.push(packed.rootNodes[w], 0)
  const top = tree?.levels[0]
  for (let c = 0; c < (top?.count ?? 0); c++) frontier.push(top!.base + c, 0)
  while (frontier.length) {
    let aheadOnly = frontier.pop() as number
    let n = frontier.pop() as number
    if (n >= packed.nodeCount && (n = memberRoot(packed, n - packed.nodeCount, covers)) < 0)
      continue
    let children = aheadOnly ? -1 : keeps(frames, nodes, nodeInts, n)
    if (children < 0 && ahead) {
      children = keeps(ahead, nodes, nodeInts, n)
      aheadOnly = 1
    }
    if (children < 0) {
      nodeFlags[n] = 2
      continue
    }
    if (children) {
      const first = firstChild(packed, nodeInts, n)
      for (let c = 0; c < children; c++) frontier.push(first + c, aheadOnly)
      continue
    }
    nodeFlags[n] = aheadOnly ? AHEAD_LEAF : 0
  }
  return nodeFlags
}
