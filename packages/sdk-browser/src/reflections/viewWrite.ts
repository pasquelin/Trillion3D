import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { invertMatrix4 } from '../../../math/src/matrix/matrix4Inverse.ts'
import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { screenSlab } from '../gpu/hiz/screenSlab.ts'
import { frontPitch } from './frontDepth.ts'
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
  /** The run-time proxy's epochs (`proxyStore.ts`, `follow`): what its answers are stamped with. */
  epochs?: { scene: number; view: number }
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
 * radiance image's view-projection and its inverse, drawn size and top level (`levels` − 1), this
 * image's drawn size, the geometry of a surface's thickness (`screenSlab`) with the world size of a
 * pixel at a unit clip `w` — 2 /
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
  const runtime = new Uint32Array(staged.buffer, AT.runtime * 4, 4)
  const inverse = new Float64Array(16)
  const runs = Array.from({ length: RUNS }, (_, k) => staged.subarray(16 * k, 16 * k + 16))
  return (frame: ReflectionFrame, held: HeldImage, levels: number) => {
    const m = frame.viewProjection
    copyMatrix4(staged, m, AT.viewProj)
    copyMatrix4(staged, held.viewProjection, AT.radianceViewProj)
    copyMatrix4(staged, invertMatrix4(inverse, held.viewProjection), AT.radianceInverse)
    const [, height] = frame.size
    staged[AT.radiance] = held.size[0]
    staged[AT.radiance + 1] = held.size[1]
    staged[AT.radiance + 2] = levels - 1
    staged.set(screenSlab(m, height), AT.slab)
    traced[0] = frame.depthDrawn && held.valid ? 1 : 0
    traced[1] = frame.size[0]
    traced[2] = frame.size[1]
    traced[3] = frontPitch(frame.size[0])
    staged[AT.proxy] = frame.proxyError
    runtime[0] = frame.epochs?.scene ?? 0
    runtime[1] = frame.epochs?.view ?? 0
    if (unchanged(sent, runs)) return
    sent.set(staged)
    device.queue.writeBuffer(buffer, 0, staged)
  }
}
