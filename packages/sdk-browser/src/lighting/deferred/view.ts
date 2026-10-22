/**
 * The view uniform of deferred resolve and composition (`VIEW_WGSL`): the inverse view-projection,
 * the camera, the viewport — size, raw-output flag, sharpening strength —, the background, the
 * contract's light parameters, the TAA jitter, the composition's source (`writeSource`) and the
 * lighting term a view shows (`writeLightView`). One
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
 *  unread, the default sharpening. */
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
] as const
/** The words of `direct` that fill `lightParams` and `display`; the one after them is the
 *  sharpening strength, the viewport's fourth word. */
const DIRECT_WORDS = 8

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
     *  tiles in X and Y, the exposure, the display curve's rank, the eye, then the sharpening. */
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
      packed[AT.viewport + 3] = direct[DIRECT_WORDS]
      packed[AT.background] = clear.r
      packed[AT.background + 1] = clear.g
      packed[AT.background + 2] = clear.b
      packed[AT.background + 3] = clear.a
      for (let i = 0; i < DIRECT_WORDS; i++) packed[AT.lightParams + i] = direct[i]
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
      if (packed[AT.views] === code) return
      packed[AT.views] = code
      device.queue.writeBuffer(buffer, AT.views * 4, packed, AT.views, 1)
    },
    dispose() {
      buffer.destroy()
    },
  }
}
