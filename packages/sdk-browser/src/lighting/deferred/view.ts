/**
 * The view uniform of deferred resolve and composition (`VIEW_WGSL`): the inverse
 * view-projection, the camera, the viewport — size, raw-output flag, rank of a sampled image —,
 * the background, the contract's light parameters and the TAA jitter. One buffer, one packed
 * array, written once per image; its words are those of `VIEW_LAYOUT`, which makes the shader's
 * struct.
 */
import {
  DEFAULT_EXPOSURE,
  DEFAULT_TONE_MAPPING,
  TONE_MAPPING_RANK,
} from '../../../../sdk-core/src/scene/core/environment.ts'
import { viewJitterWords } from './jitterWords.ts'
import { VIEW_LAYOUT } from './worldAtWgsl.ts'

const AT = VIEW_LAYOUT.at

/** The background, as `clearValueOf` reads a packed colour. */
export type ClearColor = { r: number; g: number; b: number; a: number }

/** With no declared light: zero lights, zero tiles, the default exposure and curve, the eye unread. */
export const ZERO_DIRECT = [
  0,
  0,
  0,
  DEFAULT_EXPOSURE,
  TONE_MAPPING_RANK[DEFAULT_TONE_MAPPING],
  0,
  0,
  0,
] as const

export function createDeferredView(device: GPUDevice) {
  const buffer = device.createBuffer({
    label: 'Trillion3D deferred view v1',
    size: VIEW_LAYOUT.words * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const packed = new Float32Array(VIEW_LAYOUT.words)
  const setJitter = (jitter: ArrayLike<number> | null, phase = 0) =>
    void viewJitterWords(jitter, packed, AT.jitter, phase)
  setJitter(null)
  return {
    buffer,
    /** The TAA jitter of the next image `write` writes (`viewJitterWords`). */
    setJitter,
    /** `rawOutput` skips the display chain; `sampledRank` non-zero draws a subset of each
     *  pixel's lights (`../direct/lightSamplingWgsl.ts`); `direct` carries the contract lights, the
     *  tiles in X and Y, the exposure, then the display curve's rank and the eye. */
    write(
      inverseViewProjection: ArrayLike<number>,
      camera: readonly number[],
      width: number,
      height: number,
      clear: ClearColor,
      rawOutput: boolean,
      direct: ArrayLike<number>,
      sampledRank: number,
    ) {
      packed.set(inverseViewProjection, AT.inverseViewProjection)
      packed.set(camera, AT.camera)
      packed[AT.viewport] = width
      packed[AT.viewport + 1] = height
      packed[AT.viewport + 2] = rawOutput ? 1 : 0
      packed[AT.viewport + 3] = sampledRank
      packed[AT.background] = clear.r
      packed[AT.background + 1] = clear.g
      packed[AT.background + 2] = clear.b
      packed[AT.background + 3] = clear.a
      packed.set(direct, AT.lightParams)
      device.queue.writeBuffer(buffer, 0, packed)
    },
    dispose() {
      buffer.destroy()
    },
  }
}
