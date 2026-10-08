import type { HostAttributes } from '../../host/resources.ts'
import type { GeometryBlock } from '../row/pageRowMaterial.ts'
import {
  BUFFERS,
  LAYOUT,
  LISTS,
  offsetOf,
  poolFits,
  poolFloats,
  type PoolList,
  type Stores,
} from './geometryPoolLayout.ts'
import { createPoolStores, releasePoolStores } from './geometryPoolStores.ts'
import { fillScratch, releaseScratch, scratchFloats } from './geometryPoolScratch.ts'
import { writeFloatAtlas } from './floatAtlas.ts'
import {
  claim,
  holds,
  placeBlock,
  poolBytesOf,
  put,
  writeBlock,
  type Pool,
} from './geometryPoolOps.ts'
export type { PoolList } from './geometryPoolLayout.ts'
type GeometryBlocks = Map<HostAttributes, GeometryBlock>
/**
 * THE FLOAT VERTEX POOL of the WebGPU passes: the geometry they read as floats — the clusters no
 * quantized page covers, a cache that carries none, a world's dynamic geometry (#573). Its stores
 * — two storage buffers and a normal atlas (`geometryPoolStores.ts`, #1410) — hold a block per
 * sourced geometry (`place`), a dynamic geometry's rewritten ranges written in place (`write`),
 * and, after the positions, the deformation block the callers re-place (`tailFloats`). A record
 * mounted after the open, or one whose held box asks more, grows the room in place (`ensure`):
 * the stores are made wider, the buffers' contents copied, the normals written again from their
 * geometries, and the owners told (`grown`) — no reopen (#1293). Colours ride at the tail of the
 * UV buffer (`vertexColors.ts`), which carries none when no geometry has any.
 */
export function createVertexPool(
  device: GPUDevice,
  capacity: number,
  coloured: boolean,
  blocks: GeometryBlocks,
  tailFloats = 0,
  grown?: (capacity: number) => void,
  secondUv = false,
) {
  const size = Math.max(1, capacity)
  const floats = poolFloats(size, tailFloats, coloured, secondUv)
  if (!poolFits(floats, device.limits)) throw new Error('GEOMETRY_POOL_DEVICE_LIMIT')
  const stores = createPoolStores(device, floats)
  const p: Pool = {
    ...{ device, coloured, secondUv, tailFloats, grown, blocks },
    ...{ used: 0, size, floats, stores },
  }
  return {
    /** The positions, then the deformation block. */
    get concatPos() {
      return p.stores.concatPos
    },
    get concatUv() {
      return p.stores.concatUv
    },
    /** The normal atlas's view: seven floats a vertex, a normal and its tangent. */
    get concatNrm() {
      return p.stores.concatNrm.view
    },
    /** The normal atlas itself: its view and what it weighs on the device. */
    get normalAtlas() {
      return p.stores.concatNrm
    },
    /** What the normal atlas weighs on the device. */
    get normalBytes() {
      return p.stores.concatNrm.bytes
    },
    /** Frees the pool's stores: the pool is dropped. */
    destroy: () => releasePoolStores(p.stores),
    /** Places each geometry of `sourced`, dynamic or not, and uploads the buffers whole: the
     *  open's one packing. */
    pack: (sourced: ReadonlyMap<HostAttributes, boolean>) => packPool(p, sourced),
    /** The block of `attributes`, placed in the room the open left when it has none — a record
     *  mounted since —; a mount past that room grows it in place (#1293). `dynamic` marks its
     *  rows. */
    place: (attributes: HostAttributes, dynamic = false) => placeBlock(p, attributes, dynamic),
    /** The bytes `place` then `write` send for `ranges` of `attributes`: each list whole first
     *  when its block is still to place. */
    bytesOf: (attributes: HostAttributes, ranges: readonly { name: PoolList; count: number }[]) =>
      poolBytesOf(p, attributes, ranges),
    /** Writes vertices `from` to `from + count - 1` of list `name` of placed `attributes` — a
     *  normal with its tangent — in place, no buffer allocated; returns the bytes written. */
    write: (attributes: HostAttributes, name: PoolList, from: number, count: number) =>
      writeBlock(p, attributes, name, from, count),
  }
}

/** Places each geometry of `sourced`, dynamic or not, and uploads the buffers whole. */
function packPool(p: Pool, sourced: ReadonlyMap<HostAttributes, boolean>) {
  const { device, floats } = p
  const arrays = Object.fromEntries(
    (Object.keys(floats) as (keyof typeof floats)[]).map((key) => [
      key,
      new Float32Array(floats[key]),
    ]),
  ) as Stores<Float32Array<ArrayBuffer>>
  for (const [attributes, dynamic] of sourced) {
    const block = claim(p, attributes, dynamic)
    for (const name of LISTS) {
      // The tail is written after the atlas, at its own place (`uv1Tail.ts`).
      if (!block || name === 'uv1' || !holds(p, attributes, name)) continue
      const n = fillScratch(attributes, name, 0, block.count) // grows the scratch: read it after
      arrays[LAYOUT[name].buffer].set(
        scratchFloats().subarray(0, n),
        offsetOf(name, p.size, block.vertexBase),
      )
    }
  }
  const { stores } = p
  for (const key of BUFFERS) device.queue.writeBuffer(stores[key], 0, arrays[key])
  const normals = arrays.concatNrm
  writeFloatAtlas(device.queue, stores.concatNrm, 0, normals, 0, normals.length)
  for (const [attributes, block] of p.blocks)
    if (holds(p, attributes, 'uv1'))
      put(p, attributes, 'uv1', { vertex: block.vertexBase, from: 0, n: block.count })
  releaseScratch() // the open's largest list is not kept
}

export type VertexPool = ReturnType<typeof createVertexPool>
