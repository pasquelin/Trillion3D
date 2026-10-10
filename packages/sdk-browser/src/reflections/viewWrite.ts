import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { length3 } from '../../../math/src/vector/vector.ts'
import type { HeldImage } from './radiance.ts'
import { REFLECTION_VIEW_AT as AT, REFLECTION_VIEW_WRITTEN_WORDS } from './viewLayout.ts'

/** What an image tells its reflection view (`createReflectionViewWriter`). */
export type ReflectionFrame = {
  /** The render view-projection the depth was drawn with, jitter included. */
  viewProjection: ArrayLike<number>
  /** The drawn size. */
  size: readonly [number, number]
  /** Whether the depth pyramid holds this image's whole depth. */
  depthDrawn: boolean
  /** The resident proxy's certified error, in metres: zero without a proxy. */
  proxyError: number
}

/** The geometry of a surface's thickness under the view-projection `m` (`reflectionBack`), a pixel
 *  `scale` wide at a unit clip `w`: `[scale, A, step, perspective]`. A clip depth is affine in the
 *  point, `z_c = a · w_view + b`, and the clip `w` is `c · w_view + e`: under a perspective (`c`
 *  not zero) the depth is `A + B / w`, with `A = a / c` the depth at an infinite distance; under
 *  an orthographic projection a pixel spans `scale · |a|` of depth, at every distance. */
function reflectionSlab(m: ArrayLike<number>, scale: number) {
  const gradientZ = [m[2], m[6], m[10]],
    gradientW = [m[3], m[7], m[11]]
  const perspective = gradientW.some((component) => component !== 0)
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  return [
    scale,
    perspective ? dot(gradientZ, gradientW) / dot(gradientW, gradientW) : 0,
    perspective ? 0 : scale * length3(gradientZ[0], gradientZ[1], gradientZ[2]),
    perspective ? 1 : 0,
  ]
}

/** The words of the view that the CPU writes, in 16-word runs (`sameElements`). */
const RUNS = ceilDiv(REFLECTION_VIEW_WRITTEN_WORDS, 16)

/** Whether every run of `staged` is what `sent` holds. */
function unchanged(sent: Float32Array, runs: Float32Array[]) {
  for (let k = 0; k < RUNS; k++) if (!sameElements(sent, runs[k], 16 * k)) return false
  return true
}

/**
 * The writer of a view uniform `buffer`: it stages this image's view — the view-projection, the
 * radiance image's view-projection, drawn size and top level (`levels` − 1), the geometry of a
 * surface's thickness (`reflectionSlab`) with the world size of a pixel at a unit clip `w` — 2 /
 * (height · |row y of the view-projection|), the projection's vertical scale —, whether the screen
 * is traced and the resident proxy's error; all but the surroundings, which the GPU
 * writes from the lighting's view. It writes the buffer when what it staged is not what it sent
 * last: a still view writes once, and nothing in it is a frame index or a seed. Nothing is
 * allocated by a call.
 */
export function createReflectionViewWriter(device: GPUDevice, buffer: GPUBuffer) {
  const staged = new Float32Array(REFLECTION_VIEW_WRITTEN_WORDS)
  const sent = new Float32Array(REFLECTION_VIEW_WRITTEN_WORDS)
  const traced = new Uint32Array(staged.buffer, AT.traced * 4, 4)
  const runs = Array.from({ length: RUNS }, (_, k) => staged.subarray(16 * k, 16 * k + 16))
  return (frame: ReflectionFrame, held: HeldImage, levels: number) => {
    const m = frame.viewProjection
    copyMatrix4(staged, m, AT.viewProj)
    copyMatrix4(staged, held.viewProjection, AT.radianceViewProj)
    const [, height] = frame.size
    staged[AT.radiance] = held.size[0]
    staged[AT.radiance + 1] = held.size[1]
    staged[AT.radiance + 2] = levels - 1
    staged.set(reflectionSlab(m, 2 / (height * length3(m[1], m[5], m[9]))), AT.slab)
    traced[0] = frame.depthDrawn && held.valid ? 1 : 0
    staged[AT.proxy] = frame.proxyError
    if (unchanged(sent, runs)) return
    sent.set(staged)
    device.queue.writeBuffer(buffer, 0, staged)
  }
}
