import { clamp } from '../../../math/src/scalar/reals.ts'
import { length3 } from '../../../math/src/vector/vector.ts'
import {
  DEFAULT_LIGHTING_CHANNELS,
  lightingChannelMask,
} from '../../../sdk-core/src/contracts/lightingChannelsAbi.ts'
import type { SceneLight } from '../../../sdk-core/src/scene/light/contracts.ts'
import type { BoxSphere } from './boxSphere.ts'

/** The deep shadows an image draws at most, one for each light and macro group that meet. */
export const HAIR_DEEP_SHADOW_MAX_SLOTS = 32
/** The sizes of tile the atlas holds, a power of two each from the least: this many. */
export const HAIR_DEEP_SHADOW_TILE_BINS = 6
/** The least a light's frustum reaches in front of a group, in metres: the reference's centimetre. */
export const HAIR_DEEP_SHADOW_MIN_NEAR = 0.01
/** The words of a slot's light (`DeepLight`). */
export const HAIR_DEEP_SHADOW_LIGHT_WORDS = 8
/** The bytes of a slot's view info (`DeepShadowViewInfo`). */
export const HAIR_DEEP_SHADOW_VIEW_INFO_BYTES = 160

/** The settings of the deep shadows (`hairDeepShadow*`, `hairShadowRasterizationScale`). */
export interface HairDeepShadowSettings {
  readonly resolution: number
  readonly minResolution: number
  /** The widest half frustum of a local light, in radians. */
  readonly maxHalfFov: number
  readonly aabbScale: number
  /** The scale of the least width a strand is drawn with in the shadow views. */
  readonly rasterizationScale: number
  readonly kernelType: number
  readonly kernelAperture: number
  readonly densityScale: number
  readonly depthBiasScale: number
}

/** A light that draws a deep shadow: where it is, or the way it shines, and how its layers are spread. */
export interface HairDeepShadowLight {
  readonly directional: boolean
  /** The direction a directional light shines in, or the place a local one is, in metres. */
  readonly vector: readonly [number, number, number]
  /** 0 spreads the four layers evenly, 1 gathers them near the front. */
  readonly layerDistribution: number
  /** A local light's reach in metres, 0 for none. */
  readonly range: number
  readonly lightChannels: number
}

/** The properties of a light that say whether it draws a deep shadow (`castHairDeepShadow`, off) and how its
 *  layers are spread (`hairDeepShadowLayerDistribution`, 0.5). */
type DeepShadowSource = SceneLight & {
  castHairDeepShadow?: boolean
  hairDeepShadowLayerDistribution?: number
}

/** The default spread of the layers of a deep shadow. */
const HAIR_DEEP_SHADOW_LAYER_DISTRIBUTION = 0.5

/**
 * The depths of the four layers of a deep shadow, in the clip space before it is reversed: the fifths of
 * the range, raised to an exponent that goes from 1 (an even spread) to 6.2 (layers gathered near the front)
 * with `distribution`.
 */
export function deepShadowLayerDepths(distribution: number): [number, number, number, number] {
  const exponent = clamp(distribution, 0, 1) * 5.2 + 1
  return [0.2, 0.4, 0.6, 0.8].map((depth) => depth ** exponent) as [number, number, number, number]
}

/** Whether `source` draws a deep shadow (`castHairDeepShadow`). */
const castsDeepShadow = (source: SceneLight) => !!(source as DeepShadowSource).castHairDeepShadow

/** The light `source` as the passes over the strands read it, in the camera's translated world (`eye` at the origin): a
 *  directional light by the way it shines, a local one by its place; none for a light that has neither. */
export function strandLightOf(
  source: SceneLight,
  eye: ArrayLike<number>,
): HairDeepShadowLight | undefined {
  const light = source as DeepShadowSource
  const directional = light.kind === 'directional'
  const at = directional ? light.direction : light.position
  if (!at) return undefined
  return {
    directional,
    vector: directional ? at : [at[0] - eye[0]!, at[1] - eye[1]!, at[2] - eye[2]!],
    layerDistribution: light.hairDeepShadowLayerDistribution ?? HAIR_DEEP_SHADOW_LAYER_DISTRIBUTION,
    range: directional ? 0 : (light.range ?? 0),
    lightChannels: lightingChannelMask(light.lightingChannels ?? DEFAULT_LIGHTING_CHANNELS),
  }
}

/** The lights of `lights` that draw a deep shadow: those that cast one (`strandLightOf`). Directional lights shine over the
 *  whole scene, a local light over its range. */
export function deepShadowLights(
  lights: Iterable<{ readonly light: SceneLight }>,
  eye: ArrayLike<number>,
): HairDeepShadowLight[] {
  const found: HairDeepShadowLight[] = []
  for (const { light } of lights) {
    const made = castsDeepShadow(light) ? strandLightOf(light, eye) : undefined
    if (made) found.push(made)
  }
  return found
}

/** The place, among the deep shadows' lights (`deepShadowLights`), of each light of `lights` that draws one, by the light's name. */
export function deepShadowIndexOf(
  lights: Iterable<{ readonly light: SceneLight }>,
  eye: ArrayLike<number>,
): Map<string, number> {
  const found = new Map<string, number>()
  for (const { light } of lights)
    if (castsDeepShadow(light) && strandLightOf(light, eye)) found.set(light.id, found.size)
  return found
}

/** Whether `light` reaches the macro group of `bounds`: a directional light always, a local one when its
 *  range meets the group's sphere. */
export function deepShadowReaches(light: HairDeepShadowLight, bounds: BoxSphere) {
  if (light.directional || !(light.range > 0)) return true
  const { sphere } = bounds
  const distance = length3(
    sphere[0]! - light.vector[0],
    sphere[1]! - light.vector[1],
    sphere[2]! - light.vector[2],
  )
  return distance <= light.range + sphere[3]!
}
