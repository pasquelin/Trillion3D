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
import { copyPoolStores, createPoolStores, releasePoolStores } from './geometryPoolStores.ts'
import { fillScratch, releaseScratch, scratchFloats } from './geometryPoolScratch.ts'
import { writeFloatAtlas } from './floatAtlas.ts'
import { UV1_FLOATS, writeUv1Tail } from './uv1Tail.ts'

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

/** Floats of each store of a pool of `count` vertices. */
const floatsOf = (p: Pool, count: number) => poolFloats(count, p.tailFloats, p.coloured, p.secondUv)

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

/** Makes the room for `need` more vertices in place when the pool is short: the buffers are
 *  made wider, what they hold copied into them, the old ones freed, the owners told. False when
 *  the device refuses the size — the caller then opens the session, as it did before (#1293). */
function ensure(p: Pool, need: number) {
  const { device, used, size } = p
  if (used + need <= size) return true
  let next = size
  while (next < used + need) next *= 2
  const wider = floatsOf(p, next)
  if (!poolFits(wider, device.limits)) return false
  const made = createPoolStores(device, wider),
    encoder = device.createCommandEncoder()
  copyPoolStores(encoder, p.stores, made, [size, next, p.tailFloats], p.coloured)
  device.queue.submit([encoder.finish()])
  releasePoolStores(p.stores)
  p.stores = made
  p.size = next
  p.floats = wider
  // The atlas's rows follow its size: every block's normals and second UV set are written
  // again, as placed.
  for (const [attributes, block] of p.blocks)
    for (const name of ATLAS_LISTS)
      if (holds(p, attributes, name))
        put(p, attributes, name, { vertex: block.vertexBase, from: 0, n: block.count })
  releaseScratch() // a growth's largest list is not kept, as the open's
  p.grown?.(next)
  return true
}

/** A block for `attributes` in the room left, grown when it is spent; undefined when the device
 *  bounds the size. */
export function claim(p: Pool, attributes: HostAttributes, dynamic: boolean) {
  const count = attributes.position?.count ?? 0
  // A list the pool was opened without — colours, a second UV set — opens the session again.
  if ((attributes.color && !p.coloured) || (attributes.uv1 && !p.secondUv) || !ensure(p, count))
    return undefined
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
