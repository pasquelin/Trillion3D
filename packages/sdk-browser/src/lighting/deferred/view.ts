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
  0,
] as const
/** The words of `direct` that fill `lightParams` and `display`; the ones after them are the
 *  sharpening strength, the viewport's fourth word, then the image's pre-exposure and the scale the
 *  composition multiplies it by (`preExposure`, `PreExposure`), then whether the image carries an alpha
 *  channel (`propagateAlpha`, 1 or 0). */
const DIRECT_WORDS = 8
/** Where `direct` holds the words after those (`DIRECT_WORDS`), and how many it holds. */
export const DIRECT_AT = { sharpness: 8, preExposure: 9, shown: 10, alpha: 11, words: 12 } as const

/** Writes the words at `at` of `drawn` pixels shown at `shown` into `packed`: the ratio on each
 *  axis, exactly 1 at the display's size, and the last pixel. True when they changed. */
function setSource(
  packed: Float32Array,
  drawn: readonly number[],
  shown: readonly number[],
  at: number = AT.source,
) {
  const x = Math.fround(drawn[0] / shown[0]),
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
  packed[AT.preExposure + 2] = direct[DIRECT_AT.alpha]
}

/** Writes `values` at the word `at` of `packed` and of `buffer`, the words alone, when one changed. */
function writeWords(
  device: GPUDevice,
  buffer: GPUBuffer,
  packed: Float32Array<ArrayBuffer>,
  at: number,
  values: readonly number[],
) {
  let same = true
  for (let i = 0; same && i < values.length; i++) same = packed[at + i] === Math.fround(values[i])
  if (same) return
  packed.set(values, at)
  device.queue.writeBuffer(buffer, at * 4, packed, at, values.length)
}

/** One word, compared and written alone. */
function writeWord(
  device: GPUDevice,
  buffer: GPUBuffer,
  packed: Float32Array<ArrayBuffer>,
  at: number,
  value: number,
) {
  if (packed[at] === Math.fround(value)) return
  packed[at] = value
  device.queue.writeBuffer(buffer, at * 4, packed, at, 1)
}

/** The words of the two- and four-word terms, rewritten by each write, never allocated. */
const PAIR = [0, 0],
  QUAD = [0, 0, 0, 0]

type ViewBuffer = { device: GPUDevice; buffer: GPUBuffer; packed: Float32Array<ArrayBuffer> }

/** The writes of an image's view: its matrices, size and background, and the source of its composition. */
function viewWrites({ device, buffer, packed }: ViewBuffer) {
  return {
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
     *  display's — the lit image drawn below it, or the temporal resolve's at its size —, and the
     *  `surface` pixels the surfaces were drawn at, the as-is pixels' (`surface`). Their words alone
     *  are written, when they change. */
    writeSource(drawn: readonly number[], shown: readonly number[], surface = drawn) {
      if (setSource(packed, drawn, shown))
        device.queue.writeBuffer(buffer, AT.source * 4, packed, AT.source, 4)
      if (setSource(packed, surface, shown, AT.surface))
        device.queue.writeBuffer(buffer, AT.surface * 4, packed, AT.surface, 4)
    },
  }
}

/** The writes of one term of the view, each when its words changed. */
function termWrites({ device, buffer, packed }: ViewBuffer) {
  return {
    /** The lighting term a view of the lit image shows in place of the surface (`LIT_VIEWS`,
     *  `../../visibility/shader/shadeMode.ts`), zero the lit surface: its word alone is written,
     *  when it changes. */
    writeLightView(code: number) {
      writeWord(device, buffer, packed, AT.views, code)
    },
    /** The shading models' switches this image, as the `MODEL_SWITCH` bits of the fourth word of the lighting term's
     *  (`../../materials/surface/pixelModel.ts`). Written when it changes. */
    writeModelSwitches(bits: number) {
      writeWord(device, buffer, packed, AT.views + 3, bits)
    },
    /** The distance at which a subsurface-model surface's colour is the light's transmittance (`preExposure.w`; the setting
     *  `subsurfaceColorTransmittanceDistance`). Its word alone is written, when it changes. */
    writeSubsurfaceDistance(distance: number) {
      writeWord(device, buffer, packed, AT.preExposure + 3, distance)
    },
    /** How the resolve applies the ambient occlusion this image drew (`../ao/frame.ts`): the mode's code — 0 none, 1 to the
     *  scene's emission and sky light, 2 to the screen probes' light — and the share it applies at. Its two words
     *  alone are written, when they change. */
    writeAmbientOcclusion(mode: number, amount: number) {
      PAIR[0] = mode
      PAIR[1] = amount
      writeWords(device, buffer, packed, AT.views + 1, PAIR)
    },
    /** How the resolve reads the screen probes' history this image (`../bounce/screen/indirectWgsl.ts`): whether the material's
     *  occlusion multiplies their light (1 or 0), the albedo the occlusion's multi-bounce is capped at, the strength of their
     *  short-range occlusion and their mode — bit 0 set their occlusion alone over the sky light's irradiance, else their light; bit 1 set a level that gathers no back light of a thin surface. Its four
     *  words alone are written, when they change. */
    writeScreenProbes(
      materialOcclusion: number,
      maxAlbedo: number,
      intensity: number,
      mode: number,
    ) {
      QUAD[0] = materialOcclusion
      QUAD[1] = maxAlbedo
      QUAD[2] = intensity
      QUAD[3] = mode
      writeWords(device, buffer, packed, AT.screenProbes, QUAD)
    },
  }
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
  setSource(packed, [1, 1], [1, 1], AT.surface)
  const parts = { device, buffer, packed }
  return {
    buffer,
    /** The TAA jitter of the next image `write` writes (`viewJitterWords`). */
    setJitter,
    ...viewWrites(parts),
    ...termWrites(parts),
    dispose() {
      buffer.destroy()
    },
  }
}
