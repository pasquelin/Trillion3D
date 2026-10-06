// The image the engine drew, read back from the bench canvas's texture and written as a PNG: what
// a run measured can be looked at, and two runs compared pixel for pixel.
import { writeFileSync } from 'node:fs'
import { encodePng } from '../../packages/sdk-node/src/cutout/png.mts'
import type { BenchGpu } from './device.ts'
import { readBack } from './readBack.ts'

/** Reads `texture` (8-bit RGBA or BGRA) back as RGBA rows, `width` × `height`, uncounted. */
async function readTexture(gpu: BenchGpu, device: GPUDevice, texture: GPUTexture) {
  const { width, height, format } = texture
  const stride = Math.ceil((width * 4) / 256) * 256
  const read = gpu.quiet(() =>
    device.createBuffer({
      size: stride * height,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    }),
  )
  const rows = new Uint8Array(
    await readBack(gpu, device, read, stride * height, (encoder) =>
      encoder.copyTextureToBuffer({ texture }, { buffer: read, bytesPerRow: stride }, [
        width,
        height,
      ]),
    ),
  )
  read.destroy()
  const rgba = new Uint8Array(width * height * 4)
  const [r, b] = format.startsWith('bgra') ? [2, 0] : [0, 2]
  for (let y = 0; y < height; y++) {
    const from = y * stride,
      to = y * width * 4
    for (let x = 0; x < width * 4; x += 4) {
      rgba[to + x] = rows[from + x + r]
      rgba[to + x + 1] = rows[from + x + 1]
      rgba[to + x + 2] = rows[from + x + b]
      rgba[to + x + 3] = 255 // the canvas is opaque
    }
  }
  return { rgba, width, height }
}

/** Writes the canvas's current image as a PNG at `path`; returns its size. */
export async function captureCanvas(
  gpu: BenchGpu,
  device: GPUDevice,
  texture: GPUTexture,
  path: string,
) {
  const { rgba, width, height } = await readTexture(gpu, device, texture)
  writeFileSync(path, encodePng(width, height, rgba))
  return { path, width, height }
}

/** Pixels that differ between two images of one size, and the largest channel difference. */
export function pixelDifference(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return { pixels: Number.NaN, largest: Number.NaN }
  let pixels = 0,
    largest = 0
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(
      Math.abs(a[i] - b[i]),
      Math.abs(a[i + 1] - b[i + 1]),
      Math.abs(a[i + 2] - b[i + 2]),
    )
    if (d) pixels++
    if (d > largest) largest = d
  }
  return { pixels, largest }
}
