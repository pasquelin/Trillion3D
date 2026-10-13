import type { HostAttributes } from '../../host/resources.ts'
import type { GeometryBlock } from '../row/pageRowMaterial.ts'
import {
  LAYOUT,
  LISTS,
  offsetOf,
  poolFits,
  poolFloats,
  type PoolList,
} from './geometryPoolLayout.ts'
import {
  copyPoolStores,
  createPoolBuffers,
  createPoolStores,
  releasePoolBuffers,
  releasePoolStores,
  storesBytes,
  type PoolStores,
} from './geometryPoolStores.ts'
import { pendingMade } from '../../gpu/core/tableGrowth.ts'
import { fillScratch, releaseScratch, scratchFloats } from './geometryPoolScratch.ts'
import { writeFloatAtlas } from './floatAtlas.ts'
import { UV1_FLOATS, writeUv1Tail } from './uv1Tail.ts'
import { grownLength } from '../../../../math/src/sequence/resized.ts'
import { nextPow2 } from '../../../../math/src/scalar/integers.ts'

/** The lists of the normal atlas, written again at a growth. */
const ATLAS_LISTS: readonly PoolList[] = ['normal', 'uv1']

/** What the vertex pool's methods share (`geometryPool.ts`): its options, its blocks, the room
 *  used and held, the floats of each store, the stores. */
export type Pool = {
  device: GPUDevice
  coloured: boolean
  secondUv: boolean
  tailFloats: number
  grown: ((capacity: number) => void) | undefined
  blocks: Map<HostAttributes, GeometryBlock>
  used: number
  size: number
  floats: ReturnType<typeof poolFloats>
  stores: ReturnType<typeof createPoolStores>
}

/** The lists a pool carries beside the positions and the normals (`poolFloats`). */
type Carried = Pick<Pool, 'coloured' | 'secondUv'>

/** Floats of each store of a pool of `count` vertices. */
const floatsOf = (p: Carried, count: number, tail: number) =>
  poolFloats(count, tail, p.coloured, p.secondUv)

/** Writes `n` floats of the scratch at float `at` of list `name`'s store. */
function upload(p: Pool, name: PoolList, at: number, n: number) {
  const key = LAYOUT[name].buffer
  if (key === 'concatNrm')
    writeFloatAtlas(p.device.queue, p.stores.concatNrm, at, scratchFloats(), 0, n)
  else p.device.queue.writeBuffer(p.stores[key], at * 4, scratchFloats(), 0, n)
}

/** Whether `attributes` carry list `name`: a missing one reads zero, as a new buffer holds. */
export const holds = (p: Pool, attributes: HostAttributes, name: PoolList) =>
  (name !== 'color' || p.coloured) &&
  (name !== 'uv1' || p.secondUv) &&
  LAYOUT[name].parts.some(([source]) => attributes[source])

/** Writes vertices `from` to `from + n - 1` of list `name` of `attributes` at pool vertex
 *  `vertex`: a second UV set at the normal atlas's tail (`uv1Tail.ts`). Returns its floats. */
export function put(
  p: Pool,
  attributes: HostAttributes,
  name: PoolList,
  at: { vertex: number; from: number; n: number },
) {
  const written = fillScratch(attributes, name, at.from, at.n)
  const { queue } = p.device
  if (name === 'uv1')
    writeUv1Tail(queue, p.stores.concatNrm, at.vertex, scratchFloats(), written / UV1_FLOATS)
  else upload(p, name, offsetOf(name, p.size, at.vertex), written)
  return written
}

/** The bytes `count` vertices of list `name` of `attributes` weigh in the pool, if it holds it. */
const weigh = (p: Pool, attributes: HostAttributes, name: PoolList, count: number) =>
  holds(p, attributes, name) ? count * LAYOUT[name].stride * 4 : 0

/** The pool laid out for `size` vertices and a tail of `tail` floats, in place, carrying the lists
 *  of `carried` (the lists it holds, or more: `widen`): the buffers made over, what the held ones
 *  hold copied into them (positions, colours, the tail as it stood), the old ones freed. A pool of
 *  another size, or one that gains a second UV set, makes its normal atlas over too, whose rows
 *  follow its size and whose tail is the set, and every block's normals and second UV set are
 *  written again, as placed; one of the same layout keeps it. False when the device refuses the
 *  size. */
function remake(p: Pool, size: number, tail: number, carried: Carried = p) {
  const { device } = p
  const wider = floatsOf(carried, size, tail)
  if (!poolFits(wider, device.limits)) return false
  const resized = size !== p.size || carried.secondUv !== p.secondUv,
    made: PoolStores = resized
      ? createPoolStores(device, wider)
      : { ...createPoolBuffers(device, wider), concatNrm: p.stores.concatNrm }
  // A pool whose atlas stays frees the buffers alone.
  const free = (held: PoolStores) => (resized ? releasePoolStores(held) : releasePoolBuffers(held))
  pendingMade(made, storesBytes(made), free, () => {
    const encoder = device.createCommandEncoder(),
      held = p.stores
    copyPoolStores(encoder, held, made, [p.size, size, p.tailFloats], p.coloured)
    device.queue.submit([encoder.finish()])
    p.stores = made
    p.size = size
    p.tailFloats = tail
    p.floats = wider
    p.coloured = carried.coloured
    p.secondUv = carried.secondUv
    return held
  }).commit()
  if (!resized) return true
  // The atlas's rows follow its size: every block's normals and second UV set are written
  // again, as placed.
  for (const [attributes, block] of p.blocks)
    for (const name of ATLAS_LISTS)
      if (holds(p, attributes, name))
        put(p, attributes, name, { vertex: block.vertexBase, from: 0, n: block.count })
  releaseScratch() // a growth's largest list is not kept, as the open's
  return true
}

/** Makes the room for `need` more vertices in place when the pool is short (`remake`), the owners
 *  told. False when the device refuses the size — the caller then opens the session, as it did
 *  before (#1293). */
function ensure(p: Pool, need: number) {
  const { used, size } = p
  if (used + need <= size) return true
  const next = size * nextPow2((used + need) / size)
  if (!remake(p, next, p.tailFloats)) return false
  p.grown?.(next)
  return true
}

/** Room for a tail of `tail` floats after the positions, grown by the engine's rule when the pool
 *  is short (`remake`). False when the device refuses the size. The owners are told by the caller,
 *  which draws the tail again. */
export function reserveTail(p: Pool, tail: number) {
  return tail <= p.tailFloats || remake(p, p.size, grownLength(p.tailFloats, tail))
}

/** The pool carries the lists `attributes` has — colours, a second UV set — which it was opened
 *  without: laid out wider by the open's own rule (`poolFloats`), what it holds copied, the owners
 *  told. False when the device refuses the size. */
function widen(p: Pool, attributes: HostAttributes) {
  const carried = {
    coloured: p.coloured || !!attributes.color,
    secondUv: p.secondUv || !!attributes.uv1,
  }
  if (carried.coloured === p.coloured && carried.secondUv === p.secondUv) return true
  if (!remake(p, p.size, p.tailFloats, carried)) return false
  p.grown?.(p.size)
  return true
}

/** A block for `attributes` in the room left, grown when it is spent; undefined when the device
 *  bounds the size. */
export function claim(p: Pool, attributes: HostAttributes, dynamic: boolean) {
  const count = attributes.position?.count ?? 0
  if (!widen(p, attributes) || !ensure(p, count)) return undefined
  const block: GeometryBlock = {
    ...{ vertexBase: p.used, count, hasUv: !!attributes.uv, hasNormal: !!attributes.normal },
    ...{ hasTangent: !!attributes.tangent, hasColor: !!attributes.color, dynamic },
    hasUv1: !!attributes.uv1,
  }
  p.blocks.set(attributes, block)
  p.used += count
  return block
}

/** Writes vertices `from` to `from + count - 1` of list `name` of placed `attributes` — a
 *  normal with its tangent — in place, no buffer allocated; returns the bytes written. */
export function writeBlock(
  p: Pool,
  attributes: HostAttributes,
  name: PoolList,
  from: number,
  count: number,
) {
  const block = p.blocks.get(attributes)
  if (!block || !holds(p, attributes, name)) return 0
  const n = Math.min(count, block.count - from)
  return put(p, attributes, name, { vertex: block.vertexBase + from, from, n }) * 4
}

/** The block of `attributes`, placed when it has none, each of its lists written. */
export function placeBlock(p: Pool, attributes: HostAttributes, dynamic: boolean) {
  const known = p.blocks.get(attributes)
  if (known) return known
  const block = claim(p, attributes, dynamic)
  if (block) for (const name of LISTS) writeBlock(p, attributes, name, 0, block.count)
  return block
}

/** The bytes `place` then `write` send for `ranges` of `attributes`: each list whole first when
 *  its block is still to place. */
export function poolBytesOf(
  p: Pool,
  attributes: HostAttributes,
  ranges: readonly { name: PoolList; count: number }[],
) {
  let bytes = 0
  if (!p.blocks.has(attributes))
    for (const name of LISTS) bytes += weigh(p, attributes, name, attributes.position?.count ?? 0)
  for (const { name, count } of ranges) bytes += weigh(p, attributes, name, count)
  return bytes
}
