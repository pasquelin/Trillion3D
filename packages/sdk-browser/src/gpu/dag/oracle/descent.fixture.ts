import { DAG_NODE_FLOATS } from '../types.ts'
import { dagNodeFloor, dagNodeVerdict, dagTreeVerdict } from './nodeVerdict.fixture.ts'
import { NODE_FIRST_CHILD, NODE_KIND, NODE_PAGE_COUNT } from '../nodeLayout.ts'
import { TREE_GROUP, type PlacementTree } from '../placementTree.ts'
import { drawsCard } from '../../../page/cut/select.fixture.ts'
import { thresholdOf, type DagViewFrames } from './math.fixture.ts'

/** A kept leaf reached only by the view ahead (`../shader/aheadWgsl.ts`): its pages are requested
 *  ahead and never drawn. */
export const AHEAD_LEAF = 3

/** One view's verdict on node `n` read by placement `w`: `-1` rejected — outside, too fine or too
 *  coarse —, else its children. `open`, the placement's open count there (`dagNodeFloor`). */
function keeps(
  frames: DagViewFrames,
  packed: Descended,
  nodeInts: Uint32Array,
  n: number,
  w: number,
) {
  const { nodes } = packed
  if (nodeInts[n * DAG_NODE_FLOATS + NODE_KIND]) return dagTreeVerdict(frames, nodes, nodeInts, n)
  const children = dagNodeVerdict(frames, nodes, nodeInts, n, w)
  if (children < 0) return -1
  const open = packed.heldOpen?.get(w, n)
  return dagNodeFloor(frames, nodes, nodeInts, n, w, open) > thresholdOf(frames, w) ? -1 : children
}

/**
 * Each (placement, node) verdict a descent spoke: `1`, never reached, by default — a primitive's
 * nodes are its placements' alike, so a verdict is a placement's.
 */
function createDescentFlags() {
  const byPlacement = new Map<number, Map<number, number>>()
  return {
    at: (w: number, n: number) => byPlacement.get(w)?.get(n) ?? 1,
    set(w: number, n: number, flag: number) {
      let flags = byPlacement.get(w)
      if (!flags) byPlacement.set(w, (flags = new Map()))
      flags.set(n, flag)
    },
  }
}
export type DescentFlags = ReturnType<typeof createDescentFlags>

type Descended = {
  nodeCount: number
  worldCount: number
  nodes: Float32Array
  rootNodes: Uint32Array
  mark?: Uint32Array
  placementTree?: PlacementTree
  world?: { root: number }
  heldOpen?: { get(w: number, node: number): number | undefined }
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

/** The placement a member entry (`nodeCount + k`, member `k` of the tree's order) names, and the
 *  root it opens, or none: parked, drawn by its card, or drawn by the world DAG. */
function memberRoot(packed: Descended, k: number, covers: Covers) {
  const w = packed.placementTree!.order[k]
  return { w, root: w === 0xffffffff ? -1 : placementRoot(packed, w, covers) }
}

/** The root placement `w` opens, or none: parked, drawn by its card, or by the world DAG. */
function placementRoot(packed: Descended, w: number, covers: Covers) {
  const root = packed.rootNodes[w]
  return root === 0xffffffff || drawsCard(packed.mark?.[w]) || covers(w) ? -1 : root
}

/**
 * Oracle descent: the Node mirror of `../shader/levelWgsl.ts`, each entry a node and the placement
 * that reads it.
 *
 * A rejected node yields nothing, and a never-reached leaf stays rejected. The flags carry each
 * (placement, node) verdict — non-zero means « the camera does not descend here » —, and only kept
 * leaves fall back to zero: they alone are what clusters consult next. A node the camera rejects is tried
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
  const nodeInts = new Uint32Array(packed.nodes.buffer),
    tree = packed.placementTree
  const nodeFlags = createDescentFlags()
  /** Quadruples: the node, the placement reading it, whether it is the view ahead's alone, then its
   *  level. */
  const frontier: number[] = []
  // The cut opens no descent on a root its impostor card draws (`drawsCard`, `markOf`).
  const opened = tree ? (packed.world ? [packed.world.root] : []) : packed.rootNodes.keys()
  for (const w of opened)
    if (placementRoot(packed, w, covers) >= 0) frontier.push(packed.rootNodes[w], w, 0, 0)
  const top = tree?.levels[0]
  for (let c = 0; c < (top?.count ?? 0); c++) frontier.push(top!.base + c, 0, 0, 0)
  // The entries each level's queue holds, as the kernel counts them: queue 0 a slot a root (a
  // placement's without a tree, the top nodes and the world DAG's with one); and the candidates.
  const work = {
    levels: [tree ? (top?.count ?? 0) + (packed.world ? 1 : 0) : packed.worldCount],
    candidates: 0,
  }
  while (frontier.length) {
    const level = frontier.pop() as number
    let aheadOnly = frontier.pop() as number
    let w = frontier.pop() as number
    let n = frontier.pop() as number
    if (n >= packed.nodeCount) {
      const member = memberRoot(packed, n - packed.nodeCount, covers)
      if (member.root < 0) continue
      ;({ w, root: n } = member)
    }
    let children = aheadOnly ? -1 : keeps(frames, packed, nodeInts, n, w)
    if (children < 0 && ahead) {
      children = keeps(ahead, packed, nodeInts, n, w)
      aheadOnly = 1
    }
    if (children < 0) {
      nodeFlags.set(w, n, 2)
      continue
    }
    if (children) {
      const first = firstChild(packed, nodeInts, n)
      for (let c = 0; c < children; c++) frontier.push(first + c, w, aheadOnly, level + 1)
      work.levels[level + 1] = (work.levels[level + 1] ?? 0) + children
      continue
    }
    nodeFlags.set(w, n, aheadOnly ? AHEAD_LEAF : 0)
    work.candidates += nodeInts[n * DAG_NODE_FLOATS + NODE_PAGE_COUNT]
  }
  return Object.assign(nodeFlags, { work })
}
