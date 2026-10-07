import type {
  CookedInstance,
  CookedPhysics,
  CookedTile,
} from '../../../sdk-core/src/physics/index.ts'
import { boxPointDistance, boxTransform } from '../../../math/src/geometry/box.ts'
import { Box3 } from '../../../sdk-core/src/world/math/box3.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { Quaternion } from '../../../sdk-core/src/world/math/quaternion.ts'
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { Bodied } from './bodies.ts'
import type { NodeMove } from './cookedBodies.ts'
import type { SharedShape, SharedShapes } from './sharedShapes.ts'
import { resolveCameraWorld } from '../camera/world.ts'
import { worldPoseOf } from './bodyFrame.ts'
import { hypot3 } from '../../../math/src/float/hypot.ts'
import { selectByKey } from '../../../math/src/select.ts'

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
  /** The update its body last left by for another body's slot (`evictFarthest`); `Infinity` once
   *  it is out for good, its model gone or its body refused: no body is built for it since. */
  left: number
}

/** A cooked tile as the session shares it (`sharedShapes.ts`), its manifest entry beside, and the
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
/** How much farther than it came in a resident tile stays, so one at the edge of a reach is not
 *  loaded and released every frame. */
const HYSTERESIS = 1.5

const place = new Matrix4(),
  local = new Matrix4(),
  position = new Vector3(),
  turn = new Quaternion(),
  size = new Vector3(),
  bounds = new Box3()

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
    counts = new Map<CookedTile, { href: string; count: number }>()
  for (const instance of cooked.instances) {
    const { tiles, material } = cooked.colliders[instance.collider]
    for (const tile of tiles) {
      const p: Placed = {
        ...{ model, instance, shape: null as unknown as TileShape, material: material ?? -1 },
        ...{ box: new Float64Array(6), id: -1, near: Infinity, left: -1 },
      }
      locate(p, tile)
      placed.push(p)
      const counted = counts.get(tile)
      if (counted) counted.count++
      else counts.set(tile, { href: cookedHref(model, tile.url), count: 1 })
    }
  }
  const held = new Map<CookedTile, TileShape>()
  for (const [tile, { href, count }] of counts) {
    const extra = { tile, near: Infinity, seen: -1, slotted: -1, counted: -1, kept: -1 }
    held.set(
      tile,
      shapes.hold('tile', href, tile.bytes, { ...extra, waiting: [], waits: 0 }, count),
    )
  }
  let at = 0
  for (const { collider } of cooked.instances)
    for (const tile of cooked.colliders[collider].tiles) placed[at++].shape = held.get(tile)!
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
 * compiled model's body moving its node (`nested`, its `velocity` by slot) —, the reach its half
 * size plus the way it travels in `LOOKAHEAD_S` seconds; written over the front of `out`, whose
 * values it returns the count of.
 */
export function moversOf(
  meshes: readonly (Bodied | null)[],
  nested: ReadonlyMap<number, NodeMove>,
  velocity: Float32Array,
  out: number[],
) {
  let n = 0
  for (const mesh of meshes) {
    if (!mesh || mesh.physics.type !== 'dynamic') continue
    const box = mesh.localBounds()
    bounds.makeEmpty()
    if (box) bounds.copy(box).applyMatrix4(mesh.matrixWorld)
    const half = bounds.isEmpty() ? 0 : bounds.getSize(size).length() / 2
    const v = mesh.physics.velocity
    out[n++] = mesh.position.x
    out[n++] = mesh.position.y
    out[n++] = mesh.position.z
    out[n++] = half + hypot3(v.x, v.y, v.z) * LOOKAHEAD_S
  }
  for (const [slot, moves] of nested) {
    const at = worldPoseOf(moves.node).position,
      v = slot * 6
    out[n++] = at[0]
    out[n++] = at[1]
    out[n++] = at[2]
    out[n++] = moves.reach + hypot3(velocity[v], velocity[v + 1], velocity[v + 2]) * LOOKAHEAD_S
  }
  return n
}

/**
 * How near tile `p` is wanted: 0 within reach of a moving body of the first `count` values of
 * `movers` (`moversOf`), its distance to `eye` within `range`, else `Infinity`; a resident tile
 * `HYSTERESIS` times as far.
 */
export function nearness(
  p: Placed,
  eye: ArrayLike<number>,
  range: number,
  movers: number[],
  count: number,
) {
  const keep = p.id >= 0 ? HYSTERESIS : 1
  for (let m = 0; m < count; m += 4)
    if (boxPointDistance(p.box, 0, movers[m], movers[m + 1], movers[m + 2]) <= movers[m + 3] * keep)
      return 0
  const near = boxPointDistance(p.box, 0, eye[0], eye[1], eye[2])
  return near <= range * keep ? near : Infinity
}
