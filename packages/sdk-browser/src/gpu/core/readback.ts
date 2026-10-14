import { giveReadback, takeReadback } from './heldReadback.ts'
import { copyRowBytes } from './copyRowBytes.ts'
import { mapStaging } from './readbackRing.ts'

/**
 * The readbacks the proof tools and an explicit capture do, and that no frame does.
 *
 * Neither is a render pass: they allocate their staging buffer, submit their own copy, wait for
 * the mapping and return the buffer. An engine that renders frames never calls them — only a host
 * that wants to check what the GPU wrote calls them.
 */

/**
 * The one held read: `bytes` taken from the device's held mapped buffer (`heldReadback.ts`) under
 * `label`, `encode` copying into it, submitted, mapped, `read` from its mapped range, given back —
 * a failed read's buffer destroyed instead. `signal` is checked once mapped.
 */
async function heldRead<T>(
  device: GPUDevice,
  bytes: number,
  label: string,
  encode: (encoder: GPUCommandEncoder, staging: GPUBuffer) => void,
  read: (mapped: ArrayBuffer) => T,
  signal?: AbortSignal,
) {
  const staging = takeReadback(device, bytes, label)
  let done = false
  try {
    const encoder = device.createCommandEncoder({ label })
    encode(encoder, staging)
    device.queue.submit([encoder.finish()])
    await mapStaging(staging)
    signal?.throwIfAborted()
    const value = read(staging.getMappedRange())
    staging.unmap()
    done = true
    return value
  } finally {
    if (done) giveReadback(device, staging)
    else staging.destroy()
  }
}

/** Copies `bytes` bytes of a GPU buffer from byte `offset`, `undefined` under four bytes. */
export async function readGpuBuffer(
  device: GPUDevice,
  source: GPUBuffer,
  bytes: number,
  offset = 0,
): Promise<Uint32Array | undefined> {
  if (bytes < 4) return undefined
  return heldRead(
    device,
    bytes,
    'Trillion3D buffer readback',
    (encoder, staging) => encoder.copyBufferToBuffer(source, offset, staging, 0, bytes),
    (mapped) => new Uint32Array(mapped.slice(0)),
  )
}

/** Copies an `r32float` target as one float per texel, rows packed, the top first: four bytes a
 *  texel, as the RGBA8 capture (`readGpuImage`) reads them. */
export async function readGpuTextureR32F(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<Float32Array | undefined> {
  if (width < 1 || height < 1) return undefined
  const bytes = await readGpuImage(device, texture, width, height, undefined, { topDown: true })
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

/** How `readGpuImage` reads: which level of the texture, and in which row order. */
export interface ReadImageOptions {
  /** The level copied, whose size `width` × `height` is (default 0). */
  mipLevel?: number
  /** Rows kept as WebGPU writes them, the top first, not flipped to the bottom-left convention. */
  topDown?: boolean
}

/** Explicit capture only, never a frame's: one texture copy into the device's held mapped buffer
 *  (`heldReadback.ts`; a failed capture's is destroyed), awaited, the frame never stalled on it.
 *  Copies WebGPU top-left rows to the bottom-left convention, unless `topDown`; its own array. */
export async function readGpuImage(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
  signal?: AbortSignal,
  { mipLevel = 0, topDown = false }: ReadImageOptions = {},
) {
  signal?.throwIfAborted()
  const bytesPerRow = copyRowBytes(width),
    row = width * 4
  return heldRead(
    device,
    bytesPerRow * height,
    'Trillion3D explicit capture',
    (encoder, buffer) =>
      encoder.copyTextureToBuffer(
        { texture, mipLevel },
        { buffer, bytesPerRow, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 },
      ),
    (range) => {
      const mapped = new Uint8Array(range),
        pixels = new Uint8Array(row * height)
      for (let y = 0; y < height; y++)
        pixels.set(
          mapped.subarray(y * bytesPerRow, y * bytesPerRow + row),
          (topDown ? y : height - 1 - y) * row,
        )
      return pixels
    },
    signal,
  )
}
