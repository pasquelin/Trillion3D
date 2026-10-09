import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { sameElements } from '../../../math/src/matrix/matrixElements.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { length3 } from '../../../math/src/vector/vector.ts'
import { REFLECTION_VIEW_AT as AT, REFLECTION_VIEW_WRITTEN_WORDS } from './viewLayout.ts'

/** What an image tells its reflection view (`createReflectionViewWriter`). */
export type ReflectionFrame = {
  /** The render view-projection the depth was drawn with, jitter included, and its inverse. */
  viewProjection: ArrayLike<number>
  inverseViewProjection: ArrayLike<number>
  /** The eye, `w` 1, or the view direction, `w` 0, as the lighting reads it. */
  camera: ArrayLike<number>
  /** The drawn size. */
  size: readonly [number, number]
  /** Whether the depth pyramid holds this image's whole depth. */
  depthDrawn: boolean
  /** The background as the display shows it, in linear, the exposure and the display curve's
   *  rank: what the surroundings are made from (`SURROUNDINGS_SHADER`). */
  background: ArrayLike<number>
  exposure: number
  curve: number
}

/** What the radiance pyramid holds, which the view carries: whether it holds an image of this
 *  view, its view-projection and its drawn size. */
export type HeldImage = {
  valid: boolean
  viewProjection: ArrayLike<number>
  size: readonly [number, number]
}

/** The words of the view that the CPU writes, in 16-word runs (`sameElements`). */
const RUNS = ceilDiv(REFLECTION_VIEW_WRITTEN_WORDS, 16)

/** Whether every run of `staged` is what `sent` holds. */
function unchanged(sent: Float32Array, runs: Float32Array[]) {
  for (let k = 0; k < RUNS; k++) if (!sameElements(sent, runs[k], 16 * k)) return false
  return true
}

/**
 * The writer of a view uniform `buffer`: it stages this image's view — its matrices, the eye, the
 * drawn size and the world size of a pixel at a unit clip `w` — 2 / (height · |row y of the
 * view-projection|), the projection's vertical scale —, the radiance image's view-projection, drawn
 * size and top level (`levels` − 1), whether the screen is traced, the display curve's rank, the
 * background displayed and the exposure; all but the surroundings, which the GPU writes. It writes
 * the buffer when what it staged is not what it sent last: a still view writes once, and nothing in
 * it is a frame index or a seed. Nothing is allocated by a call.
 */
export function createReflectionViewWriter(device: GPUDevice, buffer: GPUBuffer) {
  const staged = new Float32Array(REFLECTION_VIEW_WRITTEN_WORDS)
  const sent = new Float32Array(REFLECTION_VIEW_WRITTEN_WORDS)
  const counts = new Uint32Array(staged.buffer, AT.counts * 4, 4)
  const runs = Array.from({ length: RUNS }, (_, k) => staged.subarray(16 * k, 16 * k + 16))
  return (frame: ReflectionFrame, held: HeldImage, levels: number) => {
    const m = frame.viewProjection
    copyMatrix4(staged, m, AT.viewProj)
    copyMatrix4(staged, frame.inverseViewProjection, AT.inverseViewProj)
    copyMatrix4(staged, held.viewProjection, AT.radianceViewProj)
    staged.set(frame.camera, AT.camera)
    const [width, height] = frame.size
    staged[AT.screen] = width
    staged[AT.screen + 1] = height
    staged[AT.screen + 2] = 2 / (height * length3(m[1], m[5], m[9]))
    staged[AT.radiance] = held.size[0]
    staged[AT.radiance + 1] = held.size[1]
    staged[AT.radiance + 2] = levels - 1
    counts[0] = frame.depthDrawn && held.valid ? 1 : 0
    counts[1] = frame.curve
    staged.set(frame.background, AT.display)
    staged[AT.display + 3] = frame.exposure
    if (unchanged(sent, runs)) return
    sent.set(staged)
    device.queue.writeBuffer(buffer, 0, staged)
  }
}
