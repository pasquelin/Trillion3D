import { texelBytesOf } from '../../gpu/core/textureBytes.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { hasTextureFormatsTier1 } from '../../gpu/core/textureFormatsTier.ts'
import {
  BUFFER_FORMS,
  rejectionStorageForms,
  type StorageForm,
  type StorageForms,
} from './storageForms.ts'
import { textureLimits } from '../../gpu/core/textureLimits.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { halfSize } from '../filters/levelSizes.ts'
import { frameSequenceOf, slotsOf, type FrameSequence } from './historyFrames.ts'
import { taaKnobs, type TaaLevelKnobs } from './levels.ts'
import { readTemporalSetting } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import type { TemporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/**
 * The formats the temporal pass stores to, on `features`, the device's. A compute pass stores to a
 * texture of the formats the core of WebGPU lists as storage formats (`rgba8`, `rgba16float`…) and,
 * with the feature `texture-formats-tier1` (§ 25.19 of the specification,
 * https://www.w3.org/TR/webgpu/#texture-formats-tier1; § 26.1.1 "Plain color formats" lists
 * `rg11b10ufloat`, `rg8unorm` and `rg8uint` as `"write-only"` storage formats under it), of those
 * too: with it the history keeps its colour in the 11-11-10 format, four bytes a pixel, its
 * metadata — the validity alone — in one 8-bit channel and the anti-aliaser's
 * target in two 8-bit integer channels; without
 * it half floats, eight bytes (JUSTIFIED-WEB: the core's storage formats hold no 11-11-10 and no
 * one-or-two-channel 8-bit format, so the core `rgba16float`, `rgba8unorm` and `rgba8uint` stand in,
 * each channel they add left at zero). The packed formats are kept wherever the device stores to
 * them, unless the setting `temporalHistoryPacked` is off.
 */
export interface HistoryFormats {
  /** The history's colour. */
  readonly color: GPUTextureFormat
  /** The history's metadata: its validity in red, eight bits (the weights' sum, kept rounded up). */
  readonly validity: GPUTextureFormat
  /** The render-resolution shading history (`rejectionWgsl.ts`): the colour in the perceptual space,
   *  ten bits a channel, beside the reprojection edge in two bits; where the device stores no
   *  packed format, half floats, whose ten bits of mantissa keep the same steps. */
  readonly guide: GPUTextureFormat
  /** The anti-aliaser's target: its offset in red, its noise filtering in green, eight bits each. */
  readonly antiAlias: GPUTextureFormat
  /** The measures taken before the translucency and the thin geometry's outputs, one byte a texel
   *  a layer (`MEASURE_LAYERS`, `flickerLumaWgsl.ts`): the flicker luma is measured in eight bits
   *  and a byte holds each of the others. */
  readonly measure: GPUTextureFormat
  /** The anti-aliasing mask: an `r8uint` texture where the packed formats are kept and the device
   *  grants the storage textures it takes, else a buffer (`rejectionStorageForms`). */
  readonly mask: StorageForm
  /** The LDR luma: an `r8unorm` texture where the device grants the storage texture it takes beside
   *  the others, else a buffer (`rejectionStorageForms`). */
  readonly luma: StorageForm
}

const PACKED_FORMATS = {
  color: 'rg11b10ufloat',
  validity: 'r8unorm',
  guide: 'rgb10a2unorm',
  antiAlias: 'rg8uint',
  measure: 'r8unorm',
} as const satisfies Omit<HistoryFormats, 'mask' | 'luma'>
const CORE_FORMATS = {
  color: HDR_FORMAT,
  validity: 'rgba8unorm',
  guide: 'rgba16float',
  antiAlias: 'rgba8uint',
  measure: 'rgba8unorm',
} as const satisfies Omit<HistoryFormats, 'mask' | 'luma'>
/** The formats held, one object for each choice (packed or core, then the mask's and the luma's
 *  forms): `sameShape` compares them by identity. */
const FORMATS = new Map<string, HistoryFormats>()
const formatsOf = (base: 'packed' | 'core', forms: StorageForms): HistoryFormats => {
  const key = `${base} ${forms.mask} ${forms.luma}`
  let held = FORMATS.get(key)
  if (!held)
    FORMATS.set(key, (held = { ...(base === 'packed' ? PACKED_FORMATS : CORE_FORMATS), ...forms }))
  return held
}

/** Bytes of the half-size image of a display `width × height`, which the history update writes
 *  beside its colour where the history is the display's size, the resolve where it is larger
 *  (`historyResolve.ts`), in the history's colour format `format` (`HistoryFormats.color`: 11-11-10
 *  floats where the device stores to them: four bytes a texel against eight for half floats). */
export const halfImageBytes = (width: number, height: number, format: GPUTextureFormat) => {
  const [halfWidth, halfHeight] = halfSize(width, height)
  return halfWidth * halfHeight * texelBytesOf(format)
}

/** The devices whose packed programs a driver refused, by their `features`, the one object every
 *  reader of a device's formats names: they keep the core's formats. */
const refusedPacked = new WeakSet<object>()

/** The formats of the pass on `features` and `limits`, packed where `packed` asks and the device
 *  stores to them (`HistoryFormats`, `temporalHistoryPacked`). The mask is a texture wherever the
 *  device grants it and its driver has not refused the tier 1 programs, whatever the setting. */
export const historyFormatsOf = (
  features: { has(name: string): boolean },
  packed: boolean,
  limits?: { maxStorageTexturesPerShaderStage?: number },
): HistoryFormats => {
  const refused = refusedPacked.has(features)
  const forms = refused ? BUFFER_FORMS : rejectionStorageForms(features, limits)
  const usable = !refused && hasTextureFormatsTier1(features)
  return formatsOf(packed && usable ? 'packed' : 'core', forms)
}

/** The device of `features` keeps the core's formats from now on: its driver refused the programs
 *  that store to the packed ones. */
export const refusePackedFormats = (features: object) => void refusedPacked.add(features)

/** What the pass's settings, the level's knobs and the device make of a history: its size, the
 *  frames it keeps and the formats it stores to, and whether it reprojects by the field. */
export interface HistoryShape {
  /** The history's size in pixels: the display's at 100 percent, twice it at 200. */
  readonly width: number
  readonly height: number
  /** The display's size it follows. */
  readonly displayWidth: number
  readonly displayHeight: number
  /** The frames it keeps (`FrameSequence`). */
  readonly sequence: FrameSequence
  /** The formats of each frame's colour and validity, and of the anti-aliaser's target. */
  readonly formats: HistoryFormats
  /** Whether the pass reprojects by the field. */
  readonly field: boolean
  /** Whether the level runs the spatial anti-aliaser. */
  readonly antiAlias: boolean
}

/** The settings of a history besides the level: the frames the resurrection keeps for good,
 *  the images between two, and whether the colour is packed. */
export interface HistorySettings {
  readonly frames: number
  readonly interval: number
  /** Whether the history is packed (`temporalHistoryPacked`). */
  readonly packed: boolean
}

/** The factor per axis a history is made at of the display's size, 1 to 2: the level's percent,
 *  held to the device's widest side — a history that would pass it is the display's size. Each
 *  frame's colour and validity are textures of their own, so the side is the one limit of the size. */
function historyFactor(percent: number, width: number, height: number, side: number) {
  const wanted = clamp(percent / 100, 1, 2)
  const widest = Math.max(1, side / Math.max(width, height))
  return wanted > widest ? 1 : wanted
}

/**
 * The shape of the history of a display `display` pixels wide and `displayHeight` high at the level
 * of `knobs`, with `settings`, on a device of `limits` and `features`: the size is the display's
 * times the level's percent (`historyFactor`), rounded up; the frames are those of the resurrection
 * the level runs, else one; the formats are the device's (`historyFormatsOf`).
 */
function historyShapeOf(
  knobs: TaaLevelKnobs,
  settings: HistorySettings,
  display: number,
  displayHeight: number,
  limits:
    | {
        maxTextureDimension2D?: number
        maxTextureArrayLayers?: number
        maxStorageTexturesPerShaderStage?: number
      }
    | undefined,
  features: { has(name: string): boolean },
): HistoryShape {
  const { side, layers } = textureLimits(limits)
  const sequence = frameSequenceOf(knobs.resurrection, settings.frames, settings.interval, layers)
  const formats = historyFormatsOf(features, settings.packed, limits)
  const factor = historyFactor(knobs.historyPercent, display, displayHeight, side)
  return {
    width: Math.ceil(display * factor),
    height: Math.ceil(displayHeight * factor),
    displayWidth: display,
    displayHeight,
    sequence,
    formats,
    field: knobs.reprojectionField,
    antiAlias: knobs.antiAliasIterations > 0,
  }
}

/** Whether two shapes are the same history. */
export const sameShape = (a: HistoryShape, b: HistoryShape) =>
  a.width === b.width &&
  a.height === b.height &&
  a.displayWidth === b.displayWidth &&
  a.displayHeight === b.displayHeight &&
  a.sequence.storage === b.sequence.storage &&
  a.sequence.period === b.sequence.period &&
  a.formats === b.formats &&
  a.field === b.field &&
  a.antiAlias === b.antiAlias

/** Whether the history is made at more than the display's size, so a resolve brings it down. */
export const isUpscaled = (shape: HistoryShape) =>
  shape.width !== shape.displayWidth || shape.height !== shape.displayHeight

/** Bytes of one pixel of every frame of a history of `shape`: its colour and its validity in each
 *  slot. */
export const historyBytesPerPixel = (shape: HistoryShape) =>
  slotsOf(shape.sequence) *
  (texelBytesOf(shape.formats.color) + texelBytesOf(shape.formats.validity))

/**
 * The shape of the history a pass wants (`historyShapeOf`), remembered: the shape of the last
 * `knobs`, `settings` and display size asked is returned as it was made, so an image that asks
 * every frame allocates nothing while they stand.
 */
export function createShapeMemo(device: Pick<GPUDevice, 'features' | 'limits'>) {
  let last:
    | {
        knobs: TaaLevelKnobs
        settings: HistorySettings
        width: number
        height: number
        shape: HistoryShape
      }
    | undefined
  return (
    knobs: TaaLevelKnobs,
    settings: HistorySettings,
    width: number,
    height: number,
  ): HistoryShape => {
    if (
      last &&
      last.knobs === knobs &&
      last.settings.frames === settings.frames &&
      last.settings.interval === settings.interval &&
      last.settings.packed === settings.packed &&
      last.width === width &&
      last.height === height
    )
      return last.shape
    const shape = historyShapeOf(knobs, settings, width, height, device.limits, device.features)
    last = { knobs, settings, width, height, shape }
    return shape
  }
}

/** The shape of the history a view's pass `temporal` wants at `level`, for a display `width ×
 *  height`: the level's knobs, as the session's settings of the resurrection, the reprojection field and
 *  the flicker rejection make them, its settings of the frames the resurrection keeps, and the
 *  formats the pass was made with. */
export const wantedShapeOf = (
  rt: Pick<WebgpuPagesRuntime, 'context'>,
  temporal: { wanted: ReturnType<typeof createShapeMemo>; packed: boolean },
  level: TemporalAntialiasingLevel,
  width: number,
  height: number,
) =>
  temporal.wanted(
    taaKnobs(level, rt.context),
    {
      frames: readTemporalSetting(rt, 'temporalResurrectionFrames'),
      interval: readTemporalSetting(rt, 'temporalResurrectionInterval'),
      packed: temporal.packed,
    },
    width,
    height,
  )
