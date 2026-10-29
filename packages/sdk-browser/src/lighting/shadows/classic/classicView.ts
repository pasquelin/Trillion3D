import { clamp } from '../../../../../math/src/scalar/reals.ts'
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import { VSM_UNIT_PER_CM } from '../vsm/constants.ts'
import {
  DEFAULT_SUN_CASCADES,
  cascadeCount,
  cascadeDistance,
  type SunCascadeSettings,
  type ViewCascadeSettings,
} from './cascadeSplits.ts'

/**
 * THE CLASSIC SHADOWS' WORDS IN THE PROJECTION'S VIEW (`VsmProjectionView.classic`, read by `classicTraceWgsl.ts`): twenty vec4s a frame, written while the shadows are classic
 * (`shadowVirtualEnable` off) and left zero otherwise. Slot `i` of the eight suns takes two: its cascades' distance (in the shader's units), exponent, fade (a share of a cascade, the view's
 * transition scale in it) and count, then its first map id and the absolute level of its clipmap's first map; then the receiver-side biases — a sun's, a point light's, a spot's transition — and the view's near plane. The casters' own depth biases (a cascade's, a spot's) are taken where they are drawn (`atlas/drawBias.ts`).
 */
export const CLASSIC_SUN_SLOTS = 8
/** The vec4s of the block. */
export const CLASSIC_VEC4S = 20
/** The factors a light's own shadow biases take, 0 to this (`SceneLight.shadowBias`, `shadowSlopeBias`). */
export const BIAS_FACTOR_MAX = 4
/** The defaults of the two factors (`ShadowBias`, `ShadowSlopeBias`). */
export const DEFAULT_SHADOW_BIAS = 0.5
const unorm16 = (x: number) => Math.round(clamp(x / BIAS_FACTOR_MAX, 0, 1) * 65535)

/** A light's two bias factors packed in a word, 16 bits each (the bias in the low half, the slope's in the high), as the shader unpacks them (`unpack2x16unorm`, times `BIAS_FACTOR_MAX`). */
export const classicBiasWord = (bias = DEFAULT_SHADOW_BIAS, slope = DEFAULT_SHADOW_BIAS) =>
  (unorm16(bias) | (unorm16(slope) << 16)) >>> 0

/** A sun of the frame: its first map's id and the settings of its cascades. */
export interface ClassicSun {
  readonly mapId: number
  readonly cascades?: SunCascadeSettings
}

/** The settings the words are written from. */
export type ClassicSettings = Pick<
  ShadowValues,
  | 'shadowDistanceScale'
  | 'shadowCsmMaxCascades'
  | 'shadowCsmTransitionScale'
  | 'shadowMaxCsmResolution'
  | 'shadowCsmDepthBias'
  | 'shadowCsmReceiverBias'
  | 'shadowPointLightDepthBias'
  | 'shadowPointLightSlopeScaleDepthBias'
  | 'shadowSpotLightTransitionScale'
  | 'shadowSpotLightReceiverBias'
>

/** The cascade settings the view reads: its distance scale, the most cascades, the transition scale, and its near plane in centimetres. */
export const viewCascadesOf = (
  shadows: ClassicSettings,
  nearCentimetres: number,
): ViewCascadeSettings => ({
  distanceScale: shadows.shadowDistanceScale,
  maxCascades: shadows.shadowCsmMaxCascades,
  transitionScale: shadows.shadowCsmTransitionScale,
  near: nearCentimetres,
})

/** Writes the block into `out` from word `at`: the first `CLASSIC_SUN_SLOTS` of `suns`, the settings, the near plane `nearCentimetres` and the resolution the cascades are drawn at (`cascadeResolutionIn`). */
export function writeClassicView(
  out: Float32Array,
  at: number,
  suns: readonly ClassicSun[],
  shadows: ClassicSettings,
  nearCentimetres: number,
  cascadeResolution = shadows.shadowMaxCsmResolution,
) {
  out.fill(0, at, at + 4 * CLASSIC_VEC4S)
  const view = viewCascadesOf(shadows, nearCentimetres)
  const transitionScale = clamp(view.transitionScale, 0, 2)
  for (let slot = 0; slot < CLASSIC_SUN_SLOTS; slot++) {
    const sun = suns[slot]
    const o = at + 8 * slot
    out[o + 4] = -1
    if (!sun) continue
    const settings = sun.cascades ?? DEFAULT_SUN_CASCADES
    out[o] = cascadeDistance(settings, view) * VSM_UNIT_PER_CM
    out[o + 1] = settings.exponent
    out[o + 2] = settings.transitionFraction * transitionScale
    out[o + 3] = cascadeCount(settings, view)
    out[o + 4] = sun.mapId
  }
  const bias = at + 4 * 16
  out[bias] = shadows.shadowCsmDepthBias
  out[bias + 2] = shadows.shadowCsmReceiverBias
  out[bias + 3] = cascadeResolution
  out[bias + 4] = shadows.shadowPointLightDepthBias
  out[bias + 5] = shadows.shadowPointLightSlopeScaleDepthBias
  out[bias + 10] = shadows.shadowSpotLightTransitionScale
  out[bias + 11] = shadows.shadowSpotLightReceiverBias
  out[bias + 12] = nearCentimetres * VSM_UNIT_PER_CM
}
