// The run-time proxy's walk of the placement tree on the CPU (`placementTreeWalk`, `../../../geometry/dag/tree/treeWalkWgsl.ts`):
// the same front-to-back walk over the packing's tree, the same steps and the same units, for the scene level
// of the rays' CPU twin (`runtimeSceneOracle.fixture.ts`).
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { DAG_NODE_FLOATS } from '../../../geometry/dag/types.ts'
import {
  NODE_CHILD_COUNT,
  NODE_FIRST_CHILD,
  NODE_KIND,
  NODE_MAX,
  NODE_MIN,
} from '../../../geometry/dag/nodeLayout.ts'
import { TREE_GROUP, type PlacementTree } from '../../../geometry/dag/placement/placementTree.ts'
import { RAY_TREE_STEPS, RAY_WORK } from './runtimeLayout.ts'
import { PLACEMENT_TREE_WALK_WGSL } from '../../../geometry/dag/tree/treeWalkWgsl.ts'
import { boxEntry, spent, type Hit, type Spent } from './runtimeOracle.fixture.ts'
import type { Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'

/** A constant of the walk, as the shader holds it (`PLACEMENT_TREE_WALK_WGSL`). */
const walkConst = (name: string) =>
  Number(new RegExp(`const ${name}:u32=(\\d+)u;`).exec(PLACEMENT_TREE_WALK_WGSL.text)![1])
const TREE_DEPTH = walkConst('WALK_DEPTH'),
  WALK_LIST = walkConst('WALK_LIST')

/** The nearest hit from `hit` over `tree`'s members, each ordered by where the ray enters its box (`entry`)
 *  and entered by `enter`, the walk's units spent in `s`. */
export function walkTree(
  tree: PlacementTree,
  o: Vec3,
  d: Vec3,
  hit: Hit,
  s: Spent,
  enter: (w: number, best: Hit) => Hit,
  entry: (w: number, limit: number) => number,
): Hit {
  let best = hit
  // The tree's nodes, indexed within the tree (`treeTable.ts`): its top is node 0.
  const nodes = new Uint32Array(tree.nodes.buffer, tree.nodes.byteOffset, tree.nodes.length)
  const float = (n: number, at: number) => tree.nodes[n * DAG_NODE_FLOATS + at]
  const box = (n: number, at: number): Vec3 => [float(n, at), float(n, at + 1), float(n, at + 2)]
  // Front to back (`placementTreeWalk`): a level's node and the children one scan of it keeps — the
  // `WALK_LIST` nearest after the last kept, by entry then index —, those entered, whether it left any out.
  type Level = {
    node: number
    held: [number, number][]
    taken: number
    last?: [number, number]
    more: boolean
  }
  const levels: Level[] = [{ node: 0, held: [], taken: 0, more: true }]
  const word = (n: number, k: number) => nodes[n * DAG_NODE_FLOATS + k]
  let done = false,
    step = 0
  walk: while (step < RAY_TREE_STEPS) {
    if (spent(s)) {
      done = true
      break
    }
    const top = levels[levels.length - 1],
      { node } = top
    const count = word(node, NODE_CHILD_COUNT),
      first = word(node, NODE_FIRST_CHILD)
    const group = word(node, NODE_KIND) === TREE_GROUP
    if (top.taken >= top.held.length) {
      if (!top.more) {
        if (levels.length === 1) {
          done = true
          break
        }
        levels.pop()
        continue
      }
      const held: [number, number][] = []
      let over = false
      for (let k = 0; k < count; k++) {
        if (step >= RAY_TREE_STEPS) break walk
        if (spent(s)) {
          done = true
          break walk
        }
        step++
        s.work += 1
        const member = group ? tree.order[first + k] : NO_INDEX
        const e = !group
          ? boxEntry(box(first + k, NODE_MIN), box(first + k, NODE_MAX), o, d, best.distance)
          : member === NO_INDEX
            ? best.distance + 1
            : entry(member, best.distance)
        const after = !top.last || e > top.last[1] || (e === top.last[1] && k > top.last[0])
        if (!(e <= best.distance) || !after) continue
        if (held.length === WALK_LIST && !(e < held[WALK_LIST - 1][1])) {
          over = true
          continue
        }
        if (held.length === WALK_LIST) {
          over = true
          held.pop()
        }
        // After the kept children of the same entry, as the shipped insertion places it.
        let j = held.length
        while (j > 0 && e < held[j - 1][1]) j--
        held.splice(j, 0, [k, e])
      }
      if (step >= RAY_TREE_STEPS) break
      top.held = held
      top.taken = 0
      top.more = over
      if (held.length) top.last = held[held.length - 1]
      continue
    }
    const [k, e] = top.held[top.taken++]
    // Past the best hit: so is every child after it, kept or not.
    if (!(e <= best.distance)) {
      top.taken = top.held.length
      top.more = false
      continue
    }
    if (group) best = enter(tree.order[first + k], best)
    else if (levels.length < TREE_DEPTH)
      levels.push({ node: first + k, held: [], taken: 0, more: true })
  }
  // A walk that ran out of steps, not of tree, is a spent ray as well.
  if (!done) s.work = RAY_WORK
  return best
}
