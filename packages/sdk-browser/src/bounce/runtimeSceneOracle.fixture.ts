// The run-time proxy's rays on the CPU (`runtimeRadianceWgsl.ts`), the scene level: the same walk of the
// placement tree and of each placement's box, over the packing's own tables, the same budget. The tests
// compare it with every triangle tested in turn.
import { PROXY_NODE_FLOATS } from '../../../sdk-core/src/contracts/writtenFormats.ts'
import type { PackedDag } from '../gpu/dag/types.ts'
import { walkTree } from './runtimeTreeOracle.fixture.ts'
import { RUNTIME_WORLD_WORDS } from './runtimeLayout.ts'
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
    ? scene.copyWorlds!.subarray(
        (w - scene.copyBase) * RUNTIME_WORLD_WORDS,
        (w - scene.copyBase + 1) * RUNTIME_WORLD_WORDS,
      )
    : scene.packed.worlds.subarray(w * 16, w * 16 + 16)

/** Member `w`'s world as its three linear columns and its translation. */
function columnsOf(scene: OracleScene, w: number): [Vec, Vec, Vec, Vec] {
  const m = worldOf(scene, w)
  return [0, 4, 8, 12].map((at) => [m[at], m[at + 1], m[at + 2]] as Vec) as [Vec, Vec, Vec, Vec]
}

/** `rtEntry`: where the ray enters placement `w`'s world box, past `limit` where it meets none. */
function entryOf(scene: OracleScene, w: number, o: Vec, d: Vec, limit: number) {
  const instance = scene.instances.get(w)
  if (!instance) return limit + 1
  const [a, b, c, t] = columnsOf(scene, w)
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
  return boxEntry(low, high, o, d, limit)
}

/** `rtEnter`: the ray against placement `w`, its world box first. */
function enter(scene: OracleScene, w: number, o: Vec, d: Vec, best: Hit, s: Spent): Hit {
  const instance = scene.instances.get(w)
  if (!instance || entryOf(scene, w, o, d, best.distance) > best.distance) return best
  const [a, b, c, t] = columnsOf(scene, w)
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

/** `rtScene`: the nearest hit over every placement, the tree walked front to back (`walkTree`). */
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
  best = walkTree(
    tree,
    o,
    d,
    best,
    s,
    (w, hit) => enter(scene, w, o, d, hit, s),
    (w, limit) => entryOf(scene, w, o, d, limit),
  )
  return copiesOf(scene, o, d, best, s)
}

/** The blended copies, members after the placements: each tried in turn, a unit apiece. */
function copiesOf(scene: OracleScene, o: Vec, d: Vec, hit: Hit, s: Spent) {
  let best = hit
  const count = scene.copyWorlds ? scene.copyWorlds.length / RUNTIME_WORLD_WORDS : 0
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
