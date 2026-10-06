import { BUFFERS, growthCopies, type BufferKey, type Stores } from './geometryPoolLayout.ts'
import { createFloatAtlas } from './floatAtlas.ts'

/** What the float vertex pool keeps on the device (`geometryPool.ts`): its position and UV
 *  storage buffers and its normal atlas (`floatAtlas.ts`, #1410). */
export type PoolStores = Record<BufferKey, GPUBuffer> & {
  concatNrm: ReturnType<typeof createFloatAtlas>
}

const label = (key: BufferKey | 'concatNrm') => `Trillion3D transparent geometry ${key}`
/** Read by the passes, written by the host, copied on a growth: read at the call, the device's
 *  globals then installed. */
const usage = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC

/** The stores of `floats` floats, zeroed. */
export const createPoolStores = (device: GPUDevice, floats: Stores<number>): PoolStores => ({
  ...(Object.fromEntries(
    BUFFERS.map((key) => [
      key,
      device.createBuffer({
        label: label(key),
        size: Math.max(4, floats[key] * 4),
        usage: usage(),
      }),
    ]),
  ) as Record<BufferKey, GPUBuffer>),
  concatNrm: createFloatAtlas(device, label('concatNrm'), floats.concatNrm),
})

/** Copies what the buffers of a pool of `from` vertices hold into the wider ones of `to`, region
 *  by region (`growthCopies`). The normal atlas, whose rows follow its size, is written again. */
export function copyPoolStores(
  encoder: GPUCommandEncoder,
  held: PoolStores,
  made: PoolStores,
  [from, to, tail]: [number, number, number],
  coloured: boolean,
) {
  for (const key of BUFFERS)
    for (const [source, destination, count] of growthCopies(key, from, to, tail, coloured))
      if (count > 0)
        encoder.copyBufferToBuffer(held[key], source * 4, made[key], destination * 4, count * 4)
}

/** Frees the stores. */
export function releasePoolStores(held: PoolStores) {
  for (const key of BUFFERS) held[key].destroy()
  held.concatNrm.texture.destroy()
}
