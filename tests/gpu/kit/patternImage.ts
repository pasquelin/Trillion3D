// What the proofs that carry an image through the GPU share: a pattern no flip, transposition,
// offset or channel swap leaves looking the same, written into a texture texel by texel; the rows
// turned between WebGPU's top-first order and the SDK's bottom-first one; how far a read lies from
// what was written; and a canvas's image read back as RGBA.
import { readGpuImage } from '../../../packages/sdk-browser/src/gpu/core/readback.ts'

/** The RGBA bytes of texel (`x`, `y`), the top row first. */
export type Texel = (x: number, y: number) => ArrayLike<number>

/** `texel` over `width` × `height`: RGBA rows, the top first as WebGPU writes them. */
export function patternBytes(width: number, height: number, texel: Texel) {
  const bytes = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) bytes.set(texel(x, y), (y * width + x) * 4)
  return bytes
}

/** `texel`'s pattern written into level `mipLevel` of `texture`, `width` × `height`; its bytes. */
export function writePattern(
  device: GPUDevice,
  texture: GPUTexture,
  [width, height]: [number, number],
  texel: Texel,
  mipLevel = 0,
) {
  const bytes = patternBytes(width, height, texel)
  device.queue.writeTexture({ texture, mipLevel }, bytes, { bytesPerRow: width * 4 }, [
    width,
    height,
  ])
  return bytes
}

/** RGBA `rows` of `width` texels the other way up: the top first becomes the bottom first. */
export function flipRows(rows: Uint8Array, width: number) {
  const stride = width * 4,
    height = rows.length / stride,
    flipped = new Uint8Array(rows.length)
  for (let y = 0; y < height; y++)
    flipped.set(rows.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride)
  return flipped
}

/** Channels of `read` that differ from `expected`, the largest gap, and texels that differ. */
export function gaps(read: ArrayLike<number>, expected: ArrayLike<number>) {
  let channels = 0,
    largest = 0
  const texels = new Set<number>()
  for (let i = 0; i < expected.length; i++)
    if (read[i] !== expected[i]) {
      channels++
      largest = Math.max(largest, Math.abs(read[i] - expected[i]))
      texels.add(i >> 2)
    }
  return { bytes: read.length, channels, largest, texels: texels.size }
}

/** The image `texture` of a canvas holds, read back as RGBA, the bottom row first like
 *  `capture()`: a `bgra` canvas's bytes swapped back. */
export async function readCanvasRgba(device: GPUDevice, texture: GPUTexture) {
  const pixels = await readGpuImage(device, texture, texture.width, texture.height)
  if (texture.format.startsWith('bgra'))
    for (let i = 0; i < pixels.length; i += 4)
      [pixels[i], pixels[i + 2]] = [pixels[i + 2], pixels[i]]
  return pixels
}

/**
 * The image the canvas of `world` holds — the last frame presented, a frame the engine drew without
 * any flush included — read back on the GPU as RGBA, bottom row first like `capture()`.
 */
export async function canvasImage(world: { canvas: HTMLCanvasElement }) {
  const context = world.canvas.getContext('webgpu') as GPUCanvasContext & {
    current: GPUTexture | null
  }
  const texture = context.current
  if (!texture) throw new Error('the canvas holds no image yet')
  return readCanvasRgba(context.getConfiguration()!.device, texture)
}
