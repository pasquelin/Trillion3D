/**
 * The view uniform of deferred resolve and composition (`VIEW_WGSL`): the inverse view-projection,
 * the camera, the viewport — size, raw-output flag, sharpening strength —, the background, the
 * contract's light parameters, the TAA jitter, the composition's source (`writeSource`), the
 * lighting term a view shows (`writeLightView`), how the ambient occlusion is applied
 * (`writeAmbientOcclusion`) and how the screen probes' history is read (`writeScreenProbes`). One
 * buffer, one packed array, written once per image; its words are those of `VIEW_LAYOUT`, which
 * makes the shader's struct.
 */
import {
  DEFAULT_SHARPNESS,
  DEFAULT_TONE_MAPPING,
  TONE_MAPPING_RANK,
} from '../../../../sdk-core/src/scene/core/environment.ts'
import { UNIT_EXPOSURE } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import { viewJitterWords } from './jitterWords.ts'
import { VIEW_LAYOUT } from './worldAtWgsl.ts'

const AT = VIEW_LAYOUT.at

/** The background, as `clearValueOf` reads a packed colour. */
export type ClearColor = { r: number; g: number; b: number; a: number }

/** With no declared light: zero lights, zero tiles, an exposure of 1, the default curve, the eye
 *  unread, the default sharpening, a pre-exposure of 1 shown at 1. */
export const ZERO_DIRECT = [
  0,
  0,
  0,
  UNIT_EXPOSURE,
  TONE_MAPPING_RANK[DEFAULT_TONE_MAPPING],
  0,
  0,
  0,
  DEFAULT_SHARPNESS,
  UNIT_EXPOSURE,
  UNIT_EXPOSURE,
] as const
/** The words of `direct` that fill `lightParams` and `display`; the ones after them are the
 *  sharpening strength, the viewport's fourth word, then the image's pre-exposure and the scale the
 *  composition multiplies it by (`preExposure`, `PreExposure`). */
const DIRECT_WORDS = 8
/** Where `direct` holds the words after those (`DIRECT_WORDS`), and how many it holds. */
export const DIRECT_AT = { sharpness: 8, preExposure: 9, shown: 10, words: 11 } as const

/** Writes the source words of `drawn` pixels shown at `shown` into `packed`: the ratio on each
 *  axis, exactly 1 at the display's size, and the last pixel. True when they changed. */
function setSource(packed: Float32Array, drawn: readonly number[], shown: readonly number[]) {
  const at = AT.source,
    x = Math.fround(drawn[0] / shown[0]),
    y = Math.fround(drawn[1] / shown[1])
  const same =
    packed[at] === x &&
    packed[at + 1] === y &&
    packed[at + 2] === drawn[0] - 1 &&
    packed[at + 3] === drawn[1] - 1
  if (same) return false
  packed[at] = x
  packed[at + 1] = y
  packed[at + 2] = drawn[0] - 1
  packed[at + 3] = drawn[1] - 1
  return true
}

/** The words of `direct` into the view's `packed` words: the light parameters and the display's, the
 *  sharpening strength, the pre-exposure and the scale shown at (the GPU copies the measured one
 *  over the last, `../../post/exposure/frame.ts`). */
function writeDirect(packed: Float32Array, direct: ArrayLike<number>) {
  packed[AT.viewport + 3] = direct[DIRECT_AT.sharpness]
  for (let i = 0; i < DIRECT_WORDS; i++) packed[AT.lightParams + i] = direct[i]
  packed[AT.preExposure] = direct[DIRECT_AT.preExposure]
  packed[AT.preExposure + 1] = direct[DIRECT_AT.shown]
}

/** Writes `values` at the word `at` of `packed` and of `buffer`, the words alone, when one changed. */
function writeWords(
  device: GPUDevice,
  buffer: GPUBuffer,
  packed: Float32Array<ArrayBuffer>,
  at: number,
  values: readonly number[],
) {
  if (values.every((value, i) => packed[at + i] === Math.fround(value))) return
  packed.set(values, at)
  device.queue.writeBuffer(buffer, at * 4, packed, at, values.length)
}

export function createDeferredView(device: GPUDevice) {
  const buffer = device.createBuffer({
    label: 'Trillion3D deferred view v1',
    size: VIEW_LAYOUT.words * 4,
    // The exposure the meter copies in is copied out again, into the finishing's uniform.
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const packed = new Float32Array(VIEW_LAYOUT.words)
  const setJitter = (jitter: ArrayLike<number> | null, phase = 0) =>
    void viewJitterWords(jitter, packed, AT.jitter, phase)
  setJitter(null)
  setSource(packed, [1, 1], [1, 1])
  return {
    buffer,
    /** The TAA jitter of the next image `write` writes (`viewJitterWords`). */
    setJitter,
    /** `rawOutput` skips the display chain; `direct` carries the contract lights, the
     *  tiles in X and Y, the exposure, the display curve's rank, the eye, then the sharpening and the
     *  pre-exposure (`DIRECT_AT`). */
    write(
      inverseViewProjection: ArrayLike<number>,
      camera: readonly number[],
      width: number,
      height: number,
      clear: ClearColor,
      rawOutput: boolean,
      direct: ArrayLike<number>,
    ) {
      packed.set(inverseViewProjection, AT.inverseViewProjection)
      packed.set(camera, AT.camera)
      packed[AT.viewport] = width
      packed[AT.viewport + 1] = height
      packed[AT.viewport + 2] = rawOutput ? 1 : 0
      packed[AT.background] = clear.r
      packed[AT.background + 1] = clear.g
      packed[AT.background + 2] = clear.b
      packed[AT.background + 3] = clear.a
      writeDirect(packed, direct)
      device.queue.writeBuffer(buffer, 0, packed)
    },
    /** The composition's source of this image: an image of `drawn` pixels shown at `shown`, the
     *  display's — the lit image drawn below it, or the temporal resolve's at its size. Its words
     *  alone are written, when they change. */
    writeSource(drawn: readonly number[], shown: readonly number[]) {
      if (setSource(packed, drawn, shown))
        device.queue.writeBuffer(buffer, AT.source * 4, packed, AT.source, 4)
    },
    /** The lighting term a view of the lit image shows in place of the surface (`LIT_VIEWS`,
     *  `../../visibility/shader/shadeMode.ts`), zero the lit surface: its word alone is written,
     *  when it changes. */
    writeLightView(code: number) {
      writeWords(device, buffer, packed, AT.views, [code])
    },
    /** How the resolve applies the ambient occlusion this image drew (`../ao/frame.ts`): the mode's code — 0 none, 1 to the
     *  scene's emission and sky light, 2 to the screen probes' light — and the share it applies at. Its two words
     *  alone are written, when they change. */
    writeAmbientOcclusion(mode: number, amount: number) {
      writeWords(device, buffer, packed, AT.views + 1, [mode, amount])
    },
    /** How the resolve reads the screen probes' history this image (`../bounce/screen/indirectWgsl.ts`): whether the material's
     *  occlusion multiplies their light (1 or 0), the albedo the occlusion's multi-bounce is capped at, the strength of their
     *  short-range occlusion and their mode — 0 their light, 1 their occlusion alone over the world's probes' light. Its four
     *  words alone are written, when they change. */
    writeScreenProbes(
      materialOcclusion: number,
      maxAlbedo: number,
      intensity: number,
      mode: number,
    ) {
      writeWords(device, buffer, packed, AT.screenProbes, [
        materialOcclusion,
        maxAlbedo,
        intensity,
        mode,
      ])
    },
    dispose() {
      buffer.destroy()
    },
  }
}
