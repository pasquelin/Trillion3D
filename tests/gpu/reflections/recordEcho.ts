// What a record table holds on the GPU, against the words the host meant it to hold: the proxy-tables proof
// (`proxy-tables.gpu.ts`) tells a walk that reads its records otherwise from a table that holds other words.
import { readGpuBuffer } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'

/** The first `most` words of `texture` (an `rgba32uint` record table of `width × rows` texels, one layer)
 *  that differ from `expected`, laid as the texture's rows: each word's index, the GPU's and the host's. */
export async function recordEcho(
  device: GPUDevice,
  texture: GPUTexture,
  [width, rows]: readonly [number, number],
  expected: Uint32Array,
  most = 16,
) {
  const bytesPerRow = width * 16,
    bytes = bytesPerRow * rows
  const buffer = device.createBuffer({
    size: bytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, rows, 1])
  device.queue.submit([encoder.finish()])
  const held = (await readGpuBuffer(device, buffer, bytes))!
  buffer.destroy()
  const differing: [number, number, number][] = []
  for (let i = 0; i < expected.length && differing.length < most; i++)
    if (held[i] !== expected[i]) differing.push([i, held[i], expected[i]])
  return differing
}
