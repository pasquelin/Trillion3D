// The image the engine drew, read back from the bench canvas's texture and written as a PNG: what
// a run measured can be looked at, and two runs compared pixel for pixel.
import { writeFileSync } from 'node:fs'
import { encodePng } from '../../packages/sdk-node/src/cutout/png.mts'
import type { BenchGpu } from './device.ts'
import { readTexture } from '../../tests/gpu/kit/computeReadback.ts'

/** Reads `texture` (8-bit RGBA or BGRA) back as RGBA rows, `width` × `height`, uncounted. */
async function readRgba(gpu: BenchGpu, device: GPUDevice, texture: GPUTexture) {
  const { width, height, format } = texture
  // The reads' commands are encoded in the call's synchronous part, so `quiet` keeps them uncounted.
  const rows = await gpu.quiet(() => readTexture(device, texture, 4))
  const rgba = new Uint8Array(width * height * 4)
  const [r, b] = format.startsWith('bgra') ? [2, 0] : [0, 2]
  for (let y = 0; y < height; y++) {
    const at = y * width * 4
    for (let x = 0; x < width * 4; x += 4) {
      rgba[at + x] = rows[at + x + r]
      rgba[at + x + 1] = rows[at + x + 1]
      rgba[at + x + 2] = rows[at + x + b]
      rgba[at + x + 3] = 255 // the canvas is opaque
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
  const { rgba, width, height } = await readRgba(gpu, device, texture)
  writeFileSync(path, encodePng(width, height, rgba))
  return { path, width, height }
}
