/**
 * FOG: THE LIGHT A MEDIUM ABSORBS AND SCATTERS BETWEEN A SURFACE AND THE EYE.
 *
 * A term of the one lighting model, applied per pixel to every surface, opaque and transparent,
 * lit or unlit alike — a normal or depth view and the diagnostic views excepted: the surface's
 * radiance `L` reaches the eye as `L · T + S`, where `T` is the transmittance along the view ray
 * and `S` the radiance the medium scatters toward the eye. Two laws give them, by the distance `d`
 * from the eye (measured from the camera's position, the height along +y):
 * - linear: `T = clamp((far − d) / (far − near), 0, 1)`, `S = color · (1 − T)`;
 * - height fog, a medium that thins out with height (`fogHeight.ts`: its law, its units, its
 *   defaults, and what the atmosphere's sky and sun add to `S`). A uniform medium is its falloff
 *   of zero.
 * Three spellings declare them: `{ color, near, far }`; the height fog's own fields
 * (`SceneHeightFog`, every one with its default); and the extinction form
 * `{ color, density, heightFalloff?, baseHeight? }`, a medium of `density` per metre
 * (Beer-Lambert, `T = exp(−density · d)` where nothing falls off), divided by e every
 * `1 / heightFalloff` metres up: a spelling of the height law, mapped to it exactly.
 * The height fog also takes a second layer, an end distance, a cubemap and a volume
 * (`fogHeight.ts`), each off by default, the views it shows in, and the sky light's capture as a
 * light of its in-scattering.
 */
import type { LinearRgb } from '../../contracts/material.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import { DEG2RAD } from '../../../../math/src/constants.ts'
import { clamp, isFiniteNumber } from '../../../../math/src/scalar/reals.ts'
import {
  booleanOf,
  colourOf,
  objectOf,
  rangedFields,
  rangedObjectOf,
  refuse,
  type FogRange,
} from './fogChecks.ts'
import { cubemapMipCount, validateFogCubemap } from './fogCubemap.ts'
import {
  heightFogOf,
  isExtinctionFog,
  type ResolvedHeightFog,
  type SceneFogDirectional,
  type SceneHeightFog,
  type SceneSkyLightScattering,
} from './fogHeight.ts'
import { validateSecondLayer } from './fogSecond.ts'
import { validateVolumetricFog } from './fogVolumetric.ts'

export type { SceneFogDirectional, SceneHeightFog } from './fogHeight.ts'

/** Fog that starts at `near` and hides everything from `far` on, distances from the eye. */
export interface SceneLinearFog {
  /** The radiance the fog fades toward, linear RGB. */
  color: LinearRgb
  /** Distance from the eye where the fog starts. */
  near: number
  /** Distance from the eye where nothing but the fog is seen. */
  far: number
}

/** The extinction form of the height fog: `density` per scene unit; with `heightFalloff`, it
 *  thins out above `baseHeight`, divided by e every `1 / heightFalloff` units up. Mapped exactly
 *  to the height law (`heightFogOf`): `baseDensity = density / (ln 2)²`, `falloff = heightFalloff
 *  / ln 2`; the other fields of `SceneHeightFog` are at their defaults. */
export interface SceneExponentialFog {
  /** The radiance the fog fades toward, linear RGB. */
  color: LinearRgb
  /** Extinction per scene unit, at `baseHeight`; ≥ 0. */
  density: number
  /** How fast the density falls off with height, per scene unit; 0, the default, keeps it
   *  uniform at every height. */
  heightFalloff?: number
  /** The height the density is `density` at; 0 by default. */
  baseHeight?: number
}

/** Distance or height fog, as the lighting reads it. */
export type SceneFog = SceneLinearFog | SceneExponentialFog | SceneHeightFog

/** The law of a fog, by the rank shaders read: none leaves the surface as it is; `exponential`
 *  is the height law. */
export const FOG_MODE = { none: 0, linear: 1, exponential: 2 } as const

/** The `vec4` slots of a fog in a GPU block, by number: the colour — a cubemap's tint where there
 *  is a cubemap — and the mode; the law's four numbers (`near, far`, or `baseDensity, falloff,
 *  baseHeight, maxOpacity`); `startDistance, cutoffDistance`, then the lobe's exponent and start
 *  distance; the lobe's colour; the factor of the sky's radiance; the unit direction toward the sun
 *  and its luminance, written by the light store (`../light/fogSun.ts`), not by `packFog`; the
 *  second layer's `baseDensity, falloff, baseHeight`; the reach — `horizontalLimit`, the volume's
 *  `farEnd` and `startAt`, and 1 where the scene turns the volume on; the cubemap's
 *  rotation `sin, cos`, its size in texels and 1 where there is one; its blend, `1 / range` and
 *  `bias`. */
export const FOG_SLOT = {
  color: 0,
  law: 1,
  range: 2,
  lobe: 3,
  sky: 4,
  sun: 5,
  second: 6,
  reach: 7,
  cubemap: 8,
  cubeBlend: 9,
} as const
/** `vec4` slots of a fog in a GPU block. */
export const FOG_SLOTS = 10
/** Floats of a fog in a GPU block: four to a slot. Written as a literal, so a bundle that packs no
 *  fog keeps none. */
const SCENE_FOG_FLOATS = 40

/** The thinnest density and the lowest opacity a fog that shows may have: at or below them it
 *  hides nothing, and is not drawn. */
const MIN_DENSITY = 1e-9
const MIN_OPACITY = 1e-5
/** The lobe's exponent, held where a power of it stays defined. */
const LOBE_EXPONENT = [1e-6, 1000] as const

/** The numbers of a height fog, each with the range it must lie in. */
const HEIGHT_RANGES = {
  baseDensity: [0, Infinity],
  falloff: [0, Infinity],
  baseHeight: [-Infinity, Infinity],
  maxOpacity: [0, 1],
  startDistance: [0, Infinity],
  cutoffDistance: [0, Infinity],
  horizontalLimit: [0, Infinity],
} as const satisfies Record<string, FogRange>

/** The switches of a height fog: the views it shows in, and whether it holds its light out. */
const VIEW_SWITCHES = ['inMainView', 'inSkyCapture', 'inReflectionCaptures', 'holdout'] as const

/** The numbers of the sky light's scattering, each with the range it must lie in. */
const SKY_LIGHT_RANGES = {
  strength: [0, Infinity],
  roughness: [0, 1],
} as const satisfies Record<string, FogRange>

/** The sky light's scattering checked, a copy: its strength ≥ 0, its roughness in [0, 1]. */
function validateSkyLightScattering(value: unknown, fog: unknown): SceneSkyLightScattering {
  return rangedObjectOf<SceneSkyLightScattering>(value, 'skyLightScattering', SKY_LIGHT_RANGES, fog)
}

/** A height fog checked, a copy of what it declares: its colours of three numbers ≥ 0, `baseHeight`
 *  finite, the other numbers ≥ 0, `maxOpacity` in [0, 1], the lobe's exponent above 0, the views it
 *  shows in true or false, the sky light's scattering strength ≥ 0 and roughness in [0, 1]. */
function validateHeightFog(fog: SceneHeightFog): SceneHeightFog {
  const out: SceneHeightFog = {}
  if (fog.color !== undefined) out.color = colourOf(fog.color, 'color', fog)
  rangedFields(fog, out, HEIGHT_RANGES, fog)
  if (fog.skyContribution !== undefined)
    out.skyContribution = colourOf(fog.skyContribution, 'skyContribution', fog)
  if (fog.directional !== undefined) {
    const lobe = objectOf<SceneFogDirectional>(fog.directional, 'directional', fog)
    const kept: SceneFogDirectional = {}
    if (lobe.exponent !== undefined) {
      if (!isFiniteNumber(lobe.exponent) || lobe.exponent <= 0)
        refuse('directional.exponent must be > 0', fog)
      kept.exponent = lobe.exponent
    }
    rangedFields(lobe, kept, { startDistance: [0, Infinity] }, fog, 'directional.')
    if (lobe.color !== undefined) kept.color = colourOf(lobe.color, 'directional.color', fog)
    out.directional = kept
  }
  if (fog.secondLayer !== undefined) out.secondLayer = validateSecondLayer(fog.secondLayer, fog)
  if (fog.cubemap !== undefined) out.cubemap = validateFogCubemap(fog.cubemap, fog)
  if (fog.volumetric !== undefined) out.volumetric = validateVolumetricFog(fog.volumetric, fog)
  for (const name of VIEW_SWITCHES)
    if (fog[name] !== undefined) out[name] = booleanOf(fog[name], name, fog)
  if (fog.skyLightScattering !== undefined)
    out.skyLightScattering = validateSkyLightScattering(fog.skyLightScattering, fog)
  return out
}

/** Whether a fog is the linear one: it declares a `near` or a `far`. */
const isLinear = (fog: SceneFog): fog is SceneLinearFog => 'near' in fog || 'far' in fog

/** The height fog a scene's fog is, every field set: none for no fog or a distance fog, which has
 *  neither a volume nor a cubemap. */
const sceneHeightFog = (fog: SceneFog | undefined) =>
  fog && !isLinear(fog) ? heightFogOf(fog) : undefined

/** Whether a height fog shows: its densities, the two layers' summed, above the thinnest, and its
 *  opacity above the lowest. The one predicate the block is written by and the volume is built by:
 *  a fog that shows nothing has no block and no volume. */
const fogShows = (h: ResolvedHeightFog) =>
  h.baseDensity + h.second.baseDensity > MIN_DENSITY && h.maxOpacity > MIN_OPACITY

/** The height fog a scene's fog is where it shows (`fogShows`), none otherwise. */
export function shownHeightFog(fog: SceneFog | undefined) {
  const h = sceneHeightFog(fog)
  return h && fogShows(h) ? h : undefined
}

/** Checks a fog and returns it validated, a copy: a linear fog, a colour of three finite numbers
 *  ≥ 0 and `0 ≤ near < far`; an extinction-form fog, its colour, `density ≥ 0`,
 *  `heightFalloff ≥ 0` and a finite `baseHeight`; or a height fog, its numbers in their ranges
 *  (`SceneHeightFog`). */
export function validateSceneFog(fog: SceneFog): SceneFog {
  if (typeof fog !== 'object' || fog === null) refuse('expects an object', fog)
  if (!isLinear(fog) && !isExtinctionFog(fog)) return validateHeightFog(fog)
  const rgb = colourOf(fog.color, 'color', fog)
  if (isExtinctionFog(fog)) {
    const { density, heightFalloff = 0, baseHeight = 0 } = fog
    if (!isFiniteNumber(density) || density < 0) refuse('density must be ≥ 0', fog)
    if (!isFiniteNumber(heightFalloff) || heightFalloff < 0)
      refuse('heightFalloff must be ≥ 0', fog)
    if (!isFiniteNumber(baseHeight)) refuse('baseHeight must be finite', fog)
    return { color: rgb, density, heightFalloff, baseHeight }
  }
  const { near, far } = fog as SceneLinearFog
  if (!isFiniteNumber(near) || !isFiniteNumber(far) || near < 0 || far <= near)
    refuse('expects 0 ≤ near < far', fog)
  return { color: rgb, near, far }
}

/** The fog's cubemap block: its rotation, its levels and the switch, then its blend — the inverse
 *  of the range between its two distances (a metre of them is never narrower than a hundred
 *  thousandth of a centimetre) and its bias; none where there is no cubemap. */
function cubemapSlots(h: ResolvedHeightFog) {
  const cube = h.cubemap
  if (!cube) return {}
  const radians = cube.turn * DEG2RAD
  const inverse = 1 / Math.max(cube.sharpFrom - cube.averageUntil, 1e-7)
  return {
    cubemap: [Math.sin(radians), Math.cos(radians), cubemapMipCount(cube.size), 1],
    cubeBlend: [inverse, -cube.averageUntil * inverse],
  }
}

/** The slots of a fog's block by name (`FOG_SLOT`), each its numbers from the first lane. */
type FogSlots = Partial<Record<keyof typeof FOG_SLOT, readonly number[]>>

/** The floats of the slots, each padded to four, in the order `FOG_SLOT` gives; the sun's slot, which
 *  the light store writes, and every slot left out are zero. */
function floatsOf(slots: FogSlots): number[] {
  return (Object.keys(FOG_SLOT) as (keyof typeof FOG_SLOT)[]).flatMap((name) => {
    const lanes = slots[name] ?? []
    return [0, 1, 2, 3].map((lane) => lanes[lane] ?? 0)
  })
}

/** The floats of a fog's block (`floatsOf`) from its resolved height fog `h` where it is one; none
 *  where the fog hides nothing. A distance fog takes the sky's radiance as it is (the factor 1). */
function numbersOf(fog: SceneFog | undefined, h = sceneHeightFog(fog)): number[] {
  if (!fog) return []
  if (isLinear(fog))
    return floatsOf({
      color: [...fog.color, FOG_MODE.linear],
      law: [fog.near, fog.far],
      sky: [1, 1, 1],
    })
  if (!h || !fogShows(h)) return []
  const { exponent, startDistance, color } = h.directional
  const volume = h.volumetric
  return floatsOf({
    color: [...(h.cubemap ? h.cubemap.tint : h.color), FOG_MODE.exponential],
    law: [h.baseDensity, h.falloff, h.baseHeight, h.maxOpacity],
    range: [h.startDistance, h.cutoffDistance, clamp(exponent, ...LOBE_EXPONENT), startDistance],
    lobe: color,
    sky: h.skyContribution,
    second: [h.second.baseDensity, h.second.falloff, h.baseHeight + h.second.heightShift],
    reach: [
      h.horizontalLimit,
      volume?.farEnd ?? 0,
      volume?.startAt ?? 0,
      volume && volume.farEnd > 0 ? 1 : 0,
    ],
    ...cubemapSlots(h),
  })
}

/** What a volume carries that the block does not: the scatter, the particleColor, the glow, the
 *  extinction scale, the fade-in, the switch of the light colours and the baked light's share; empty where it is off. Two
 *  fogs that differ in it light the volume differently. */
const volumeNumbers = (v: ResolvedHeightFog['volumetric']): number[] =>
  v
    ? [
        v.anisotropy,
        ...v.particleColor,
        ...v.glow,
        v.densityScale,
        v.fadeInRate,
        v.useFogColors ? 1 : 0,
        v.staticLightingScatteringIntensity,
      ]
    : []

/** Writes a fog into its GPU block at `offset` (`FOG_SLOT`); all zero, mode none, without one or
 *  where it hides nothing. The sun's slot is left to the light store. */
export function packFog(fog: SceneFog | undefined, out: Float32Array, offset: number) {
  out.fill(0, offset, offset + SCENE_FOG_FLOATS)
  out.set(numbersOf(fog), offset)
  return out
}

/** What a fog carries that the block does not: the views it shows in and the sky light's scattering,
 *  which the frame reads; empty where there is no height fog. Two fogs that differ in it are drawn
 *  in other views and lit otherwise. */
const viewNumbers = (h: ResolvedHeightFog | undefined): number[] =>
  h
    ? [
        h.inMainView ? 1 : 0,
        h.inSkyCapture ? 1 : 0,
        h.inReflectionCaptures ? 1 : 0,
        h.holdout ? 1 : 0,
        h.skyLightScattering.strength,
        h.skyLightScattering.roughness,
      ]
    : []

/** True when two validated fogs, or their absence, read the same: in the GPU block, in the volume's
 *  numbers, in the views they show in and the sky light's scattering, and in the cubemap's picture
 *  (the array itself, so that a picture set again, though it be the same size, is a change). Each
 *  is resolved once. */
export function sameSceneFog(a: SceneFog | undefined, b: SceneFog | undefined) {
  if (a === b) return true
  const ha = sceneHeightFog(a),
    hb = sceneHeightFog(b)
  return (
    sameValues(numbersOf(a, ha), numbersOf(b, hb)) &&
    sameValues(volumeNumbers(ha?.volumetric), volumeNumbers(hb?.volumetric)) &&
    sameValues(viewNumbers(ha), viewNumbers(hb)) &&
    ha?.cubemap?.texels === hb?.cubemap?.texels
  )
}
