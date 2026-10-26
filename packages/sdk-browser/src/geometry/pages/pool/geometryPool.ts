import type { GeometryBlock } from '../../rows/page/pageRowMaterial.ts'
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
import { createPoolStores, poolResources } from './geometryPoolStores.ts'
import { fillScratch, releaseScratch, scratchFloats } from './geometryPoolScratch.ts'
import { writeFloatAtlas } from '../../../gpu/core/floatAtlas.ts'
import { claim, placeBlock, poolBytesOf, reserveTail, writeBlock } from './geometryPoolOps.ts'
import { holds, put, type Pool } from './geometryPoolWrite.ts'
import type { Geometry } from '../../../../../sdk-core/src/world/geometry/geometry.ts'
type GeometryBlocks = Map<Geometry['attributes'], GeometryBlock>
/**
 * THE FLOAT VERTEX POOL of the WebGPU passes: the geometry they read as floats — the clusters no
 * quantized page covers, a cache that carries none, a world's dynamic geometry (#573). Its stores
 * — two storage buffers and a normal atlas (`geometryPoolStores.ts`, #1410) — hold a block per
 * sourced geometry (`place`), a dynamic geometry's rewritten ranges written in place (`write`),
 * and, after the positions, the deformation block the callers re-place (`tailFloats`). A record
 * mounted after the open, or one whose held box asks more, grows the room in place (`ensure`):
 * the stores are made wider, the buffers' contents copied, the normals written again from their
 * geometries, and the owners told (`grown`) — no reopen (#1293). Colours ride at the tail of the
 * UV buffer (`../../../gpu/core/vertexColors.ts`), which carries none when no geometry has any: the first geometry
 * that brings colours, or a second UV set, the pool was opened without lays it out wider for them
 * by the open's own rule (`poolFloats`, in `geometryPoolOps.ts`), what it holds copied, the owners
 * told.
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
    /** The vertices the buffers hold room for. */
    get size() {
      return p.size
    },
    /** Room for a tail of `tail` floats after the positions (`reserveTail`); false if refused. */
    reserve: (tail: number) => reserveTail(p, tail),
    /** Frees the pool's stores: the pool is dropped. */
    destroy: () => poolResources(p.stores).forEach((resource) => resource.destroy()),
    /** Places each geometry of `sourced` and uploads the buffers whole: the open's packing. */
    pack: (sourced: ReadonlyMap<Geometry['attributes'], boolean>) => packPool(p, sourced),
    /** The block of `attributes`, placed in the room the open left when it has none (#1293). */
    place: (attributes: Geometry['attributes'], dynamic = false) =>
      placeBlock(p, attributes, dynamic),
    /** The bytes `place` then `write` send for `ranges` of `attributes`. */
    bytesOf: (
      attributes: Geometry['attributes'],
      ranges: readonly { name: PoolList; count: number }[],
    ) => poolBytesOf(p, attributes, ranges),
    /** Writes `count` vertices from `from` of list `name` of placed `attributes` in place. */
    write: (attributes: Geometry['attributes'], name: PoolList, from: number, count: number) =>
      writeBlock(p, attributes, name, from, count),
  }
}

/** Places each geometry of `sourced`, dynamic or not, and uploads the buffers whole. */
function packPool(p: Pool, sourced: ReadonlyMap<Geometry['attributes'], boolean>) {
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
      // The tail is written after the atlas, at its own place (`../../../gpu/core/uv1Tail.ts`).
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
