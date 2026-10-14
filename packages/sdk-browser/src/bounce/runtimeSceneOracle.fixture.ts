// The run-time proxy's rays on the CPU (`runtimeRadianceWgsl.ts`), the scene level: the same walk of the
// placement tree and of each placement's box, over the packing's own tables, the same budget. The tests
// compare it with every triangle tested in turn.
import { NO_INDEX } from '../../../math/src/constants.ts'
import { PROXY_NODE_FLOATS } from '../../../sdk-core/src/contracts/writtenFormats.ts'
import { DAG_NODE_FLOATS, type PackedDag } from '../gpu/dag/types.ts'
import {
  NODE_CHILD_COUNT,
  NODE_FIRST_CHILD,
  NODE_KIND,
  NODE_MAX,
  NODE_MIN,
} from '../gpu/dag/nodeLayout.ts'
import { TREE_GROUP } from '../gpu/dag/placementTree.ts'
import { RAY_WORK } from './runtimeLayout.ts'
import { dotVector3, transformAffinePoint } from '../../../math/src/vector/vector.ts'
import { cross, subtract } from '../../../math/src/vector/vectorTuple.ts'
import {
  boxEntry,
  missed,
  spent,
  traceCut,
  triangleDistance,
  vertex,
  type ArenaColumns,
  type Hit,
  type Instance,
  type Spent,
  type Vec,
} from './runtimeOracle.fixture.ts'

/** What the scene is made of: the culling's packing (its tree, its worlds), the arena and who wears
 *  which cut. */
export type OracleScene = {
  packed: PackedDag
  columns: ArenaColumns
  instances: ReadonlyMap<number, Instance>
  /** The first blended copy's rank and the copies' worlds, sixteen floats each, after the placements. */
  copyBase?: number
  copyWorlds?: Float32Array
}

/** Member `w`'s world: the culling's, or a copy's. */
const worldOf = (scene: OracleScene, w: number) =>
  scene.copyBase !== undefined && w >= scene.copyBase
    ? scene.copyWorlds!.subarray((w - scene.copyBase) * 16, (w - scene.copyBase) * 16 + 16)
    : scene.packed.worlds.subarray(w * 16, w * 16 + 16)

/** `rtEnter`: the ray against placement `w`, its world box first. */
function enter(scene: OracleScene, w: number, o: Vec, d: Vec, best: Hit, s: Spent): Hit {
  const instance = scene.instances.get(w)
  if (!instance) return best
  const m = worldOf(scene, w)
  const a: Vec = [m[0], m[1], m[2]],
    b: Vec = [m[4], m[5], m[6]],
    c: Vec = [m[8], m[9], m[10]],
    t: Vec = [m[12], m[13], m[14]]
  const at = instance.node * PROXY_NODE_FLOATS
  const local = scene.columns.nodeBounds.subarray(at, at + 6)
  const centre = [0, 1, 2].map((k) => (local[k] + local[3 + k]) / 2),
    half = [0, 1, 2].map((k) => (local[3 + k] - local[k]) / 2)
  const world = [0, 1, 2].map((k) => a[k] * centre[0] + b[k] * centre[1] + c[k] * centre[2] + t[k]),
    extent = [0, 1, 2].map(
      (k) => Math.abs(a[k]) * half[0] + Math.abs(b[k]) * half[1] + Math.abs(c[k]) * half[2],
    )
  const low = world.map((v, k) => v - extent[k]) as Vec,
    high = world.map((v, k) => v + extent[k]) as Vec
  if (boxEntry(low, high, o, d, best.distance) > best.distance) return best
  const r0 = cross(b, c),
    det = dotVector3(a, r0)
  if (Math.abs(det) < 1e-30) return best
  const r = [r0, cross(c, a), cross(a, b)].map((row) => row.map((v) => v / det) as Vec)
  const apply = (v: Vec): Vec => [dotVector3(r[0], v), dotVector3(r[1], v), dotVector3(r[2], v)]
  const hit = traceCut(
    scene.columns,
    apply(subtract(o, t)),
    apply(d),
    best.distance,
    instance.node,
    instance.triangle,
    w,
    s,
  )
  return hit.found && hit.distance < best.distance ? hit : best
}

/** `rtScene`: the nearest hit over every placement, the tree walked depth first. */
export function traceScene(scene: OracleScene, o: Vec, d: Vec, limit: number, s: Spent): Hit {
  let best = missed(limit)
  const { packed } = scene,
    tree = packed.placementTree
  if (!tree) {
    for (let w = 0; w < packed.worldSources.length; w++) {
      if (spent(s)) break
      s.work += 1
      best = enter(scene, w, o, d, best, s)
    }
    return copiesOf(scene, o, d, best, s)
  }
  // The tree's nodes, indexed within the tree (`treeTable.ts`): its top is node 0.
  const nodes = new Uint32Array(tree.nodes.buffer, tree.nodes.byteOffset, tree.nodes.length)
  const float = (n: number, at: number) => tree.nodes[n * DAG_NODE_FLOATS + at]
  const at: number[] = [0],
    next: number[] = [0]
  let done = false
  for (let step = 0; step < 2 * RAY_WORK; step++) {
    if (spent(s)) {
      done = true
      break
    }
    const level = at.length - 1,
      node = at[level]
    const count = nodes[node * DAG_NODE_FLOATS + NODE_CHILD_COUNT],
      k = next[level]
    if (k >= count) {
      if (level === 0) {
        done = true
        break
      }
      at.pop()
      next.pop()
      continue
    }
    next[level] = k + 1
    s.work += 1
    const first = nodes[node * DAG_NODE_FLOATS + NODE_FIRST_CHILD]
    if (nodes[node * DAG_NODE_FLOATS + NODE_KIND] === TREE_GROUP) {
      const w = tree.order[first + k]
      if (w !== NO_INDEX) best = enter(scene, w, o, d, best, s)
    } else {
      const child = first + k
      const low: Vec = [
          float(child, NODE_MIN),
          float(child, NODE_MIN + 1),
          float(child, NODE_MIN + 2),
        ],
        high: Vec = [float(child, NODE_MAX), float(child, NODE_MAX + 1), float(child, NODE_MAX + 2)]
      if (boxEntry(low, high, o, d, best.distance) <= best.distance && level + 1 < 8) {
        at.push(child)
        next.push(0)
      }
    }
  }
  // A walk that ran out of steps, not of tree, is a spent ray as well.
  if (!done) s.work = RAY_WORK
  return copiesOf(scene, o, d, best, s)
}

/** The blended copies, members after the placements: each tried in turn, a unit apiece. */
function copiesOf(scene: OracleScene, o: Vec, d: Vec, hit: Hit, s: Spent) {
  let best = hit
  const count = scene.copyWorlds ? scene.copyWorlds.length / 16 : 0
  for (let k = 0; k < count; k++) {
    if (spent(s)) break
    s.work += 1
    best = enter(scene, scene.copyBase! + k, o, d, best, s)
  }
  return best
}

/** Every triangle of every placement tested in turn, through the placement's world. */
export function bruteForce(scene: OracleScene, o: Vec, d: Vec, limit: number): Hit {
  let best = missed(limit)
  for (const [w, instance] of scene.instances) {
    const m = worldOf(scene, w)
    const place = (v: Vec) => transformAffinePoint<Vec>([0, 0, 0], m, v[0], v[1], v[2])
    for (let k = 0; k < instance.triangles; k++) {
      const t = instance.triangle + k
      const corners = [0, 1, 2].flatMap((c) => place(vertex(scene.columns, t, c)))
      const distance = triangleDistance(o, d, corners, 0, best.distance)
      if (distance < best.distance) best = { distance, placement: w, triangle: t, found: true }
    }
  }
  return best
}
