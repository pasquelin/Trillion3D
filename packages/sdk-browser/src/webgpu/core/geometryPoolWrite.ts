import type { HostAttributes } from '../../host/resources.ts'
import type { GeometryBlock } from '../row/pageRowMaterial.ts'
import { LAYOUT, offsetOf, type poolFloats, type PoolList } from './geometryPoolLayout.ts'
import type { createPoolStores } from './geometryPoolStores.ts'
import { fillScratch, scratchFloats } from './geometryPoolScratch.ts'
import { writeFloatAtlas } from './floatAtlas.ts'
import { UV1_FLOATS, writeUv1Tail } from './uv1Tail.ts'

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
