import { giveReadback, takeReadback } from './heldReadback.ts'
import { alignUp } from '../../../../math/src/scalar/integers.ts'

/**
 * The readbacks the proof tools and an explicit capture do, and that no frame does.
 *
 * Neither is a render pass: they allocate their staging buffer, submit their own copy, wait for
 * the mapping and return the buffer. An engine that renders frames never calls them — only a host
 * that wants to check what the GPU wrote calls them.
 */

/** Copies `bytes` bytes of a GPU buffer, or `undefined` if the device does not map. */
export async function readGpuBuffer(
  device: GPUDevice,
  source: GPUBuffer,
  bytes: number,
): Promise<Uint32Array | undefined> {
  if (bytes < 4 || typeof device.createBuffer !== 'function') return undefined
  const staging = device.createBuffer({
    label: 'Trillion3D buffer readback',
    size: bytes,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  try {
    const encoder = device.createCommandEncoder({ label: 'Trillion3D buffer readback' })
    encoder.copyBufferToBuffer(source, 0, staging, 0, bytes)
    device.queue.submit([encoder.finish()])
    await staging.mapAsync(GPUMapMode.READ)
    const copy = new Uint32Array(staging.getMappedRange().slice(0))
    staging.unmap()
    return copy
  } finally {
    staging.destroy()
  }
}

/** Copies an `r32float` target as one float per texel, rows packed, the top first: four bytes a
 *  texel, as the RGBA8 capture (`readGpuImage`) reads them. */
export async function readGpuTextureR32F(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<Float32Array | undefined> {
  if (width < 1 || height < 1 || typeof device.createBuffer !== 'function') return undefined
  const bytes = await readGpuImage(device, texture, width, height, undefined, { topDown: true })
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
}

/** Row pitch of a readback buffer: RGBA8 rows padded to WebGPU's 256-byte alignment. */
const readbackBytesPerRow = (width: number) => alignUp(width * 4, 256)

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
  const bytesPerRow = readbackBytesPerRow(width),
    row = width * 4
  const buffer = takeReadback(device, bytesPerRow * height, 'Trillion3D explicit capture')
  let read = false
  try {
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer(
      { texture, mipLevel },
      { buffer, bytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 },
    )
    device.queue.submit([encoder.finish()])
    await buffer.mapAsync(GPUMapMode.READ)
    signal?.throwIfAborted()
    const mapped = new Uint8Array(buffer.getMappedRange()),
      pixels = new Uint8Array(row * height)
    for (let y = 0; y < height; y++)
      pixels.set(
        mapped.subarray(y * bytesPerRow, y * bytesPerRow + row),
        (topDown ? y : height - 1 - y) * row,
      )
    buffer.unmap()
    read = true
    return pixels
  } finally {
    if (read) giveReadback(device, buffer)
    else buffer.destroy()
  }
}
