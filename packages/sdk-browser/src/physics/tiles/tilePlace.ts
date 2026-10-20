import type {
  CookedInstance,
  CookedPhysics,
  CookedTile,
} from '../../../../sdk-core/src/physics/cooked.ts'
import { boxTransform } from '../../../../math/src/geometry/box.ts'
import { boxPointDistance } from '../../../../math/src/geometry/boxDistance.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { Quaternion } from '../../../../sdk-core/src/world/math/quaternion.ts'
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { createBodySlots } from '../bodies/bodySlots.ts'
import type { SharedShape, SharedShapes } from '../sharedShapes.ts'
import { resolveCameraWorld } from '../../camera/world.ts'
import { worldPoseOf } from '../bodies/bodyFrame.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import { selectByKey } from '../../../../math/src/select.ts'
import { keepRadius } from '../../geometry/partition/plan.ts'

/** A compiled model as the streamer reads it (`LoadedModel`): where its files are, and the scene
 *  node of a source node, the nodes below it and its radius (`_nodeAt`), where it numbers them. */
export type Model = Object3D & {
  isLoadedModel: true
  record: { base: string; scene?: { nodes?: readonly Object3D[] } }
  _nodeAt?(index: number): ModelNode | null
}
/** A source node of a model: its scene node, the source indices below it, its drawn radius. */
export type ModelNode = { node: Object3D; indices: number[]; radius: number }
export const isModel = (node: Object3D): node is Model =>
  (node as { isLoadedModel?: boolean }).isLoadedModel === true

/** One cooked tile placed by one instance: its world box, and whether its body is in. */
export interface Placed {
  model: Model
  instance: CookedInstance
  /** Its tile, shared by every placement of it in the session. */
  shape: TileShape
  /** The glTF material of every triangle the tile holds, `-1` for none: its collider's. */
  material: number
  /** Its world box, six values (`boxTransform`). */
  box: Float64Array
  /** The body's engine id once resident, -1 while out. */
  id: number
  /** How near the last update wanted it (`nearness`). */
  near: number
  /** Out for good, its model gone or its tile or body refused: no body is built for it since,
   *  and its opening drops it. */
  out: boolean
}

/** A cooked tile as the session shares it (`../sharedShapes.ts`), its manifest entry beside, and the
 *  marks an update leaves on it (`tileSchedule.ts`): how near its nearest wanted placement is, the
 *  update that saw it wanted, the one that gave a placement of it a body, the one that counted
 *  its bytes against the share, and the one that keeps it, a placement of it let in; and the
 *  first `waits` of `waiting`, its placements that update let in waiting for its restore. */
export type TileShape = SharedShape & {
  tile: CookedTile
  near: number
  seen: number
  slotted: number
  counted: number
  kept: number
  waiting: Placed[]
  waits: number
}

const nearOf = (p: Placed) => p.near
/** Rearranges `list[0, count)` so its first `k` are its `k` nearest, in no order. */
export const selectNearest = (list: Placed[], count: number, k: number) =>
  k > 0 && selectByKey(list, nearOf, 0, count, k - 1)

/** Seconds of travel a moving body's tiles are loaded ahead of it. */
const LOOKAHEAD_S = 1

const place = new Matrix4(),
  local = new Matrix4(),
  position = new Vector3(),
  turn = new Quaternion(),
  size = new Vector3()

/** The absolute URL of the cooked object `url` names beside `model`'s manifest. */
export const cookedHref = (model: Model, url: string) => new URL(url, model.record.base).href

/** Each cooked tile of `cooked` placed by each instance of its collider in `model`, out, its shape
 *  held from `shapes` (`SharedShapes`) by every placement of it: once per tile, by their count,
 *  once every placement is read — a file that throws holds nothing. */
export function placedOf(
  model: Model,
  cooked: CookedPhysics,
  shapes: Pick<SharedShapes, 'hold'>,
): Placed[] {
  const placed: Placed[] = [],
    byTile = new Map<CookedTile, { href: string; placed: Placed[] }>()
  for (const instance of cooked.instances) {
    const { tiles, material } = cooked.colliders[instance.collider]
    for (const tile of tiles) {
      // Its shape set below, once every placement is read.
      const p = {
        model,
        instance,
        material: material ?? -1,
        box: new Float64Array(6),
        id: -1,
        near: Infinity,
        out: false,
      } as Placed
      locate(p, tile)
      placed.push(p)
      const of = byTile.get(tile)
      if (of) of.placed.push(p)
      else byTile.set(tile, { href: cookedHref(model, tile.url), placed: [p] })
    }
  }
  for (const [tile, { href, placed: on }] of byTile) {
    const marks = { tile, near: Infinity, seen: -1, slotted: -1, counted: -1, kept: -1, waits: 0 }
    const shape = shapes.hold('tile', href, tile.bytes, { ...marks, waiting: [] }, on.length)
    for (const p of on) p.shape = shape
  }
  return placed
}

/** A tile's — or a cooked soft body's — world pose: its model's world matrix times its placement,
 *  as position, turn, scale (scratch shared by every caller: read them at once). */
export function tilePose(p: { model: Model; instance: Omit<CookedInstance, 'collider'> }) {
  const { position: t, rotation: r, scale: s } = p.instance
  position.set(t[0], t[1], t[2])
  local.compose(position, turn.set(r[0], r[1], r[2], r[3]), size.set(s[0], s[1], s[2]))
  place
    .multiplyMatrices(resolveCameraWorld(p.model).matrixWorld, local)
    .decompose(position, turn, size)
  return { place, position: position.elements, quaternion: turn.elements, scale: size }
}

/** Places a tile's world box from its pose. */
export function locate(p: Placed, tile = p.shape.tile) {
  boxTransform(p.box, 0, tile.bounds, 0, tilePose(p).place.elements)
}

/**
 * Where each moving body wants ground: `x, y, z, reach` per dynamic body — a page's mesh, or a
 * compiled model's body moving its node (`nested`, its `velocity` by slot) —, the reach the one
 * its slot cached when it was claimed (`reachOf`) plus the way it travels in `LOOKAHEAD_S`
 * seconds; written over the front of `out`, whose values it returns the count of.
 */
export function moversOf(
  slots: Pick<ReturnType<typeof createBodySlots>, 'meshes' | 'nested' | 'at'>,
  velocity: Float32Array,
  out: number[],
) {
  const { meshes, nested } = slots
  let n = 0
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i],
      owner = slots.at(i)
    if (!mesh || mesh.physics.type !== 'dynamic' || !owner || !('mesh' in owner)) continue
    const v = mesh.physics.velocity
    out[n++] = mesh.position.x
    out[n++] = mesh.position.y
    out[n++] = mesh.position.z
    out[n++] = (owner.reach ?? 0) + length3(v.x, v.y, v.z) * LOOKAHEAD_S
  }
  for (const [slot, moves] of nested) {
    const at = worldPoseOf(moves.node).position,
      v = slot * 6
    out[n++] = at[0]
    out[n++] = at[1]
    out[n++] = at[2]
    out[n++] = moves.reach + length3(velocity[v], velocity[v + 1], velocity[v + 2]) * LOOKAHEAD_S
  }
  return n
}

/**
 * How near tile `p` is wanted: 0 within reach of a moving body of the first `count` values of
 * `movers` (`moversOf`), its distance to `eye` within `range`, else `Infinity`; a resident tile as
 * far as the keep sphere of each reach (`keepRadius`), the one rule a streamed cell leaves by, so
 * one at the edge of a reach is not loaded and released every frame.
 */
export function nearness(
  p: Placed,
  eye: ArrayLike<number>,
  range: number,
  movers: number[],
  count: number,
) {
  const reach = p.id >= 0 ? keepRadius : (r: number) => r
  for (let m = 0; m < count; m += 4)
    if (boxPointDistance(p.box, 0, movers[m], movers[m + 1], movers[m + 2]) <= reach(movers[m + 3]))
      return 0
  const near = boxPointDistance(p.box, 0, eye[0], eye[1], eye[2])
  return near <= reach(range) ? near : Infinity
}
