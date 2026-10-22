import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import {
  CLOUD_TRACE_SIZES,
  CLOUD_UPSAMPLINGS,
  SKY_QUALITY_RULES,
  type SkyQualityValues,
} from '../../../../../sdk-core/src/modules/sky/quality.ts'

/**
 * THE FOUR WAYS THE CLOUDS ARE TRACED AT A REDUCED SIZE (`cloudTraceSize`), each described once,
 * and the setup one image is made with: the mode, and what the quality settings say of its paths.
 * Every pass (the scene's depth range, the tracing, the reconstruction, the composition) reads the
 * mode's description; none tests a mode's number.
 *
 * - Mode 0, `quarterToHalf`: traced at a quarter of the view per axis, rebuilt from the history at
 *   half, then enlarged. Two surfaces are traced (the closest and the furthest of the texel's
 *   block of scene depths) when the tracing is a compute pass, which it is here.
 * - Mode 1, `half`: traced at half; the traced image is enlarged by the composition, no history.
 * - Mode 2, `quarterToFull`: traced at a quarter of a full-size image, one pixel of sixteen each
 *   image, rebuilt from the history at full size. The rays are not cut at the scene's depth, and
 *   the target's size follows `cloudRenderTargetScale`.
 * - Mode 3, `full`: traced at full size, enlarged by the composition at its own size.
 *
 * A view that renders no cloud target (`cloudRenderTarget` off, an orthographic view) is traced
 * directly (`CloudSetup.direct`): one ray for each view pixel, with no history and no enlarging, the
 * result laid over the lit image as the trace writes it (`directCompose`). It takes none of the
 * four modes: the setting `cloudTraceSize` names a mode of the cloud target alone.
 */

/** The size of an image in texels. */
export interface TargetSize {
  readonly width: number
  readonly height: number
}

/** Where the tracing reads the scene's depth: the lowest and highest of the texel's block (mode 0,
 *  two surfaces), a half-size image holding one of the two by a checkerboard, or the depth
 *  itself. */
export type CloudDepthSource = 'range' | 'checkerboard' | 'scene'

/** One mode: its sizes, its order, and the paths it takes. */
export interface CloudMode {
  readonly index: 0 | 1 | 2 | 3
  /** The reconstructed image's pixel is this many view pixels, per axis. */
  readonly reconstructDownsample: number
  /** The traced image's pixel is this many reconstructed pixels, per axis. */
  readonly traceDownsample: number
  /** The order the pixels of a traced texel's block are traced in, over the images of a cycle. */
  readonly order: readonly number[]
  /** Each image traces the pixel the cycle names; else the same, the block's first. */
  readonly jittered: boolean
  /** The traced image is rebuilt from the history; else the composition reads it as it is. */
  readonly reconstructs: boolean
  /** `cloudRenderTargetScale` applies to the target. */
  readonly scalable: boolean
  /** The rays end at the scene's depth. */
  readonly cutsAtScene: boolean
  /** The fog may be laid late, with the composition. */
  readonly lateFog: boolean
  /** The composition reads the nearest with a depth test whatever is asked. */
  readonly nearestDepthOnly: boolean
  /** The composition's pixel is this many of the image it reads, per axis, with no scale. */
  readonly composeDownsample: number
}

const ORDER_2X2 = [0, 2, 3, 1]
const ORDER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

const describeMode = (index: CloudMode['index'], spec: Omit<CloudMode, 'index'>): CloudMode => ({
  index,
  ...spec,
})

const mode0 = describeMode(0, {
  reconstructDownsample: 2,
  traceDownsample: 2,
  order: ORDER_2X2,
  jittered: true,
  reconstructs: true,
  scalable: false,
  cutsAtScene: true,
  lateFog: true,
  nearestDepthOnly: false,
  composeDownsample: 2,
})
const mode1 = describeMode(1, {
  reconstructDownsample: 1,
  traceDownsample: 2,
  order: ORDER_2X2,
  jittered: false,
  reconstructs: false,
  scalable: false,
  cutsAtScene: true,
  lateFog: false,
  nearestDepthOnly: false,
  composeDownsample: 2,
})
const mode2 = describeMode(2, {
  reconstructDownsample: 1,
  traceDownsample: 4,
  order: ORDER_4X4,
  jittered: true,
  reconstructs: true,
  scalable: true,
  cutsAtScene: false,
  lateFog: true,
  nearestDepthOnly: true,
  composeDownsample: 1,
})
const mode3 = describeMode(3, {
  reconstructDownsample: 1,
  traceDownsample: 1,
  order: [0],
  jittered: false,
  reconstructs: false,
  scalable: false,
  cutsAtScene: true,
  lateFog: false,
  nearestDepthOnly: true,
  composeDownsample: 1,
})

/** The modes, in the order of `CLOUD_TRACE_SIZES`. */
export const CLOUD_MODES: readonly CloudMode[] = [mode0, mode1, mode2, mode3]

/** What a direct trace is made of: a ray for each view pixel at the view's full size, which is
 *  the geometry of mode 3 (and no more of it: the direct trace has no cloud target, no composition
 *  and no late fog). */
const DIRECT_TRACE: CloudMode = { ...mode3 }

/** The index of the nearest-with-depth-test upsampling in `CLOUD_UPSAMPLINGS`. */
const NEAREST_DEPTH = CLOUD_UPSAMPLINGS.indexOf('nearestDepth')
const JITTER_CLOSEST = CLOUD_UPSAMPLINGS.indexOf('bilinearJitterClosest')

/** What an image is made with. */
export interface CloudSetup {
  /** The clouds are traced for each view pixel and laid over the lit image as traced, with no
   *  cloud target: `mode` is then the direct trace's (`DIRECT_TRACE`). */
  readonly direct: boolean
  readonly mode: CloudMode
  /** The target's scale on the view's size: `cloudRenderTargetScale` in mode 2, else 1. */
  readonly scale: number
  /** Two surfaces are traced (the closest and the furthest), with the scene's depth range. */
  readonly minMaxDepth: boolean
  /** Where the tracing reads the scene's depth. */
  readonly depth: CloudDepthSource
  /** The composition's way, an index of `CLOUD_UPSAMPLINGS`: the one asked, or the one the mode
   *  forces. */
  readonly upsampling: number
  /** The reprojected image is held to its new neighbourhood (the reconstruction without two
   *  surfaces). */
  readonly boxConstraint: boolean
  /** The fog is laid on the clouds late, by the composition, not in the trace. */
  readonly lateFog: boolean
}

/** The settings a setup reads. */
export type CloudSetupSettings = Pick<
  SkyQualityValues,
  | 'cloudTraceSize'
  | 'cloudRenderTargetScale'
  | 'cloudUpsampling'
  | 'cloudReprojectionBoxConstraint'
  | 'cloudFogLate'
  | 'cloudRenderTarget'
>

/** The depth the tracing reads: the range with two surfaces, else the half-size checkerboard in
 *  the modes that trace at half the reconstruction's size, else the scene's depth. */
function depthSourceOf(mode: CloudMode, minMaxDepth: boolean): CloudDepthSource {
  if (minMaxDepth) return 'range'
  return mode.index === 1 || mode.index === 0 ? 'checkerboard' : 'scene'
}

/**
 * The setup of the settings. `computeTracing` is whether the tracing is a compute pass reading and
 * writing the cloud images: only then does mode 0 trace two surfaces; without, the single-surface
 * path with the half-size checkerboard depth and the reconstruction without two surfaces is taken.
 * The tracing here is a compute pass, so it is true unless a host says the device cannot.
 */
export function cloudSetupOf(
  settings: CloudSetupSettings,
  computeTracing = true,
  perspective = true,
): CloudSetup {
  // No cloud target, or a view the target does not serve (orthographic): traced for every view
  // pixel into the scene itself, none rebuilt from a history.
  const direct = !settings.cloudRenderTarget || !perspective
  const mode = direct
    ? DIRECT_TRACE
    : CLOUD_MODES[CLOUD_TRACE_SIZES.indexOf(settings.cloudTraceSize)]
  const minMaxDepth = mode.index === 0 && computeTracing
  const asked = CLOUD_UPSAMPLINGS.indexOf(settings.cloudUpsampling)
  const forced = mode.nearestDepthOnly || (asked === JITTER_CLOSEST && mode.index !== 0)
  return {
    direct,
    mode,
    scale: mode.scalable ? clamp(settings.cloudRenderTargetScale, 0.1, 1) : 1,
    minMaxDepth,
    depth: depthSourceOf(mode, minMaxDepth),
    upsampling: forced ? NEAREST_DEPTH : asked,
    boxConstraint: settings.cloudReprojectionBoxConstraint,
    lateFog: settings.cloudFogLate && mode.lateFog,
  }
}

const DEFAULT_QUALITY = /* @__PURE__ */ resolveSettings(SKY_QUALITY_RULES, {})

/** The setup the settings' defaults make: mode 0 with two surfaces. */
export const DEFAULT_CLOUD_SETUP: CloudSetup = /* @__PURE__ */ cloudSetupOf(DEFAULT_QUALITY)

/** The setup the sky light's capture traces with, whatever the view's settings: a reflection has no
 *  history and no scene depth range, so the mode 0 geometry with one surface. The capture's
 *  pipeline and its block are both made from it. */
export const CAPTURE_CLOUD_SETUP: CloudSetup = /* @__PURE__ */ cloudSetupOf(DEFAULT_QUALITY, false)

/** What a setup's images are, as a key: a change of it makes every image again. */
export const cloudLayoutKey = (setup: CloudSetup) =>
  [setup.direct ? 'd' : setup.mode.index, setup.minMaxDepth ? 'm' : 's'].join('|')

/** The nearest whole number, halves up. */
const roundHalfUp = (x: number) => Math.floor(x + 0.5)

/** A size on the target's scale (mode 2's; else the size as it is), each side rounded. */
export const scaledTarget = (setup: CloudSetup, size: TargetSize): TargetSize =>
  setup.scale === 1
    ? size
    : {
        width: roundHalfUp(size.width * setup.scale),
        height: roundHalfUp(size.height * setup.scale),
      }

/** The whole number of view pixels the target's pixel stands for beyond the mode's own factors:
 *  the inverse of the scale, rounded. */
const inverseScale = (setup: CloudSetup) => roundHalfUp(1 / setup.scale)

/** How many view pixels a traced texel stands for, per axis: what the noise's position is read at. */
export const tracedToView = (setup: CloudSetup) =>
  inverseScale(setup) * setup.mode.reconstructDownsample * setup.mode.traceDownsample

/**
 * How many texels of the scene's depth image a traced texel stands for, per axis: the image that
 * holds the depth at half the view's size takes half the factor. The texel the image traces is
 * then the one its block's pixel (`traceOffset`) names, added whole.
 */
export const depthScale = (setup: CloudSetup) =>
  setup.depth === 'scene' ? tracedToView(setup) : tracedToView(setup) / 2

/** The next image's rank in the cycle: it restarts at a camera cut, and the first image after a
 *  cut is rank 1. */
export const nextCycleRank = (mode: CloudMode, rank: number, cut: boolean) =>
  ((cut ? 0 : rank) + 1) % mode.traceDownsample ** 2

/** Which pixel of a traced texel's block the image of rank `rank` traces. */
export function traceOffset(mode: CloudMode, rank: number): readonly [number, number] {
  if (!mode.jittered) return [0, 0]
  const size = mode.traceDownsample
  const slot = mode.order[rank % size ** 2]
  return [slot % size, Math.floor(slot / size)]
}

/** The composition's scales: the view's pixels to the image's, and the image's pixel in the view's,
 *  as the target's scale moves them. */
export const composeScale = (setup: CloudSetup) =>
  [setup.scale / setup.mode.composeDownsample, setup.mode.composeDownsample * setup.scale] as const

/** Whether the clouds are drawn in a view: the sky light's capture where `inSkyCapture`, the main
 *  view where `inMainView`. */
export const cloudsInView = (
  settings: { readonly inMainView: boolean; readonly inSkyCapture: boolean },
  skyCapture: boolean,
) => (skyCapture ? settings.inSkyCapture : settings.inMainView)

/** Whether the late fog is also given to the clouds the translucent surfaces read: the late fog
 *  is on (`CloudSetup.lateFog`), `cloudFogLateOnTranslucent` is on, and the scene has a height fog. */
export const cloudFogLateOnTranslucent = (
  setup: Pick<CloudSetup, 'lateFog'>,
  quality: Pick<SkyQualityValues, 'cloudFogLateOnTranslucent'>,
  fogInScene: boolean,
) => setup.lateFog && quality.cloudFogLateOnTranslucent && fogInScene
