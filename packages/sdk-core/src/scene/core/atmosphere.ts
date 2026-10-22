/**
 * THE ATMOSPHERE: A PLANET'S AIR, LIT BY THE SUN, THAT FILLS THE SKY AND HAZES THE DISTANCE.
 *
 * One medium, three gases: the air that scatters blue (Rayleigh), a haze of larger particles that
 * scatters every colour and keeps the light going forward (Mie), and an ozone layer that only
 * absorbs. Their densities fall off with the height above the planet's ground, a sphere whose
 * top is the scene's ground plane (`groundHeight`, 0 by default: the plane `y = 0`). The sun —
 * the directional light flagged `atmosphereSun` — shines through it, and what the air scatters
 * toward the eye is drawn as radiance:
 * - the sky behind every surface, with the sun's disk and the planet's ground below the horizon,
 *   in the HDR image, so exposure, the curve and the temporal resolve treat it as any surface;
 * - the haze over the distance (aerial perspective): a surface at distance `d` reaches the eye as
 *   `L·T + S`, `T` the air's transmittance along the ray and `S` the light it scatters into it,
 *   over the scene's fog when there is one, opaque and transparent surfaces alike;
 * - the sun's own light, tinted by the air it crosses: the sun's illuminance times its
 *   transmittance at the ground, so a low sun reddens what it lights.
 * Where the atmosphere is on, `scene.background` is not shown.
 *
 * UNITS. Distances of the planet are kilometres and its coefficients per kilometre; the scene
 * stays in metres. The light is radiometric as everywhere: the sky's radiance is the sun's
 * illuminance times the scattering integrals (`L = E_sun · ∫ T · σs · phase · dt`, per steradian),
 * the one scale a surface reads — `L = albedo / π · E · cosθ` —, so a sun of 10 lux gives the same
 * sky-to-sun ratio at any intensity.
 *
 * Every field is optional; the defaults are an Earth-like planet. `true` takes them all.
 */
import { EngineError } from '../../contracts/cache.ts'
import type { LinearRgb } from '../../contracts/material.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import { finite } from './fog.ts'

/** The ozone layer: a tent of absorbing gas, `peak` of its density at `altitude`, down to none
 *  `width` below and above it. */
export interface SceneOzoneLayer {
  /** Height of the densest air of the layer, kilometres. */
  altitude: number
  /** Distance from the peak to where the layer ends, kilometres. */
  width: number
  /** Density at the peak, a share of the absorption coefficient; 1 by default. */
  peak: number
}

/** What a scene declares of its atmosphere; each field absent takes `ATMOSPHERE_DEFAULTS`'s. */
export interface SceneAtmosphere {
  /** Radius of the planet, kilometres. */
  planetRadius?: number
  /** Thickness of the air above the ground, kilometres. */
  height?: number
  /** The height, in scene metres, of the planet's ground: its top meets the scene there. */
  groundHeight?: number
  /** The planet's ground colour below the horizon, linear: the share of light it bounces. */
  groundAlbedo?: LinearRgb
  /** Rayleigh scattering at the ground, per kilometre and per colour channel. */
  rayleighScattering?: LinearRgb
  /** Height over which the Rayleigh density falls by a factor e, kilometres. */
  rayleighScaleHeight?: number
  /** Mie scattering at the ground, per kilometre and per colour channel. */
  mieScattering?: LinearRgb
  /** Mie absorption at the ground, per kilometre and per colour channel. */
  mieAbsorption?: LinearRgb
  /** How much the haze keeps the light forward, in `(−1, 1)`: 0 spreads it evenly. */
  mieAnisotropy?: number
  /** Height over which the Mie density falls by a factor e, kilometres. */
  mieScaleHeight?: number
  /** Ozone absorption at the layer's peak, per kilometre and per colour channel. */
  ozoneAbsorption?: LinearRgb
  /** Where the ozone lies. */
  ozoneLayer?: SceneOzoneLayer
  /** Multiplier of the light scattered more than once, in `[0, 100]`. */
  multiScatteringFactor?: number
  /** Multiplier of the sky's radiance, per colour channel; the sky only, not the haze. */
  skyLuminanceFactor?: LinearRgb
  /** Multiplier of the radiance scattered into the sky and the haze, per colour channel. */
  skyAndAerialPerspectiveLuminanceFactor?: LinearRgb
  /** Scale of the distance the haze builds up over: more is hazier. */
  aerialPerspectiveDistanceScale?: number
  /** Distance from the eye, kilometres, before which a surface is not hazed. */
  aerialPerspectiveStartDepth?: number
  /** Share of the sky's light the scene's fog takes on as its own colour. */
  heightFogContribution?: number
  /** The lowest elevation, degrees, the sun's transmittance is read at: a sun below it is lit as
   *  if it stood there. */
  minSunElevation?: number
  /** Scale of the samples the air is marched with, from 0.25: below 1 is cheaper and coarser, above
   *  1 finer, up to the caps the quality settings give the marches (`atmosphereSamplesMax`,
   *  `skyTableSamplesMax`, `aerialSamplesPerSlice`); 1 by default. */
  sampleCountScale?: number
}

/** An atmosphere with every field set. */
export type ResolvedAtmosphere = Required<SceneAtmosphere> & { ozoneLayer: SceneOzoneLayer }

/** The atmosphere of a scene that sets none of a field: an Earth-like planet. */
const ATMOSPHERE_DEFAULTS: ResolvedAtmosphere = /* @__PURE__ */ (() =>
  Object.freeze({
    planetRadius: 6360,
    height: 60,
    groundHeight: 0,
    groundAlbedo: Object.freeze([0.402, 0.402, 0.402]) as LinearRgb,
    rayleighScattering: Object.freeze([0.005802, 0.013558, 0.0331]) as LinearRgb,
    rayleighScaleHeight: 8,
    mieScattering: Object.freeze([0.003996, 0.003996, 0.003996]) as LinearRgb,
    mieAbsorption: Object.freeze([0.000444, 0.000444, 0.000444]) as LinearRgb,
    mieAnisotropy: 0.8,
    mieScaleHeight: 1.2,
    ozoneAbsorption: Object.freeze([0.00065, 0.001881, 0.000085]) as LinearRgb,
    ozoneLayer: Object.freeze({ altitude: 25, width: 15, peak: 1 }),
    multiScatteringFactor: 1,
    skyLuminanceFactor: Object.freeze([1, 1, 1]) as LinearRgb,
    skyAndAerialPerspectiveLuminanceFactor: Object.freeze([1, 1, 1]) as LinearRgb,
    aerialPerspectiveDistanceScale: 1,
    aerialPerspectiveStartDepth: 0.1,
    heightFogContribution: 1,
    minSunElevation: -90,
    sampleCountScale: 1,
  }))()

/** The least scale of the march's samples. */
export const LEAST_SAMPLE_SCALE = 0.25

const refuse = (message: string, atmosphere: unknown): never => {
  throw new EngineError('INVALID_SCENE_ENVIRONMENT', `atmosphere: ${message}`, { atmosphere })
}

/** The numeric fields a limit applies to. */
type NumberField = Exclude<
  keyof SceneAtmosphere,
  'ozoneLayer' | 'groundAlbedo' | 'groundHeight' | LinearField
>

/** A number the field must hold: inside `[min, max]`, or strictly inside `(min, max)` when `open`;
 *  the field's default when it is absent. */
function number(
  atmosphere: SceneAtmosphere,
  field: NumberField,
  min: number,
  max = Infinity,
  open = false,
) {
  const value = atmosphere[field] ?? (ATMOSPHERE_DEFAULTS[field] as number)
  const inside = open ? value > min && value < max : value >= min && value <= max
  if (!finite(value) || !inside)
    refuse(`${field} must be in ${open ? `(${min}, ${max})` : `[${min}, ${max}]`}`, atmosphere)
  return value
}

type LinearField =
  | 'rayleighScattering'
  | 'mieScattering'
  | 'mieAbsorption'
  | 'ozoneAbsorption'
  | 'skyLuminanceFactor'
  | 'skyAndAerialPerspectiveLuminanceFactor'

/** A colour of three finite numbers ≥ 0; the field's default when it is absent. */
function colour(atmosphere: SceneAtmosphere, field: LinearField | 'groundAlbedo'): LinearRgb {
  const value = atmosphere[field] ?? ATMOSPHERE_DEFAULTS[field]
  if (!Array.isArray(value) || value.length !== 3 || !value.every((c) => finite(c) && c >= 0))
    refuse(`${field} expects three finite numbers ≥ 0`, atmosphere)
  return [value[0], value[1], value[2]]
}

/** The scale of the march's samples, from `LEAST_SAMPLE_SCALE` with no upper bound. */
function sampleScale(atmosphere: SceneAtmosphere) {
  return number(atmosphere, 'sampleCountScale', LEAST_SAMPLE_SCALE)
}

/** The ozone layer, its fields set. */
function ozone(atmosphere: SceneAtmosphere): SceneOzoneLayer {
  const layer = { ...ATMOSPHERE_DEFAULTS.ozoneLayer, ...atmosphere.ozoneLayer }
  if (!finite(layer.altitude) || layer.altitude < 0)
    refuse('ozoneLayer.altitude must be ≥ 0', atmosphere)
  if (!finite(layer.width) || layer.width < 0) refuse('ozoneLayer.width must be ≥ 0', atmosphere)
  if (!finite(layer.peak) || layer.peak < 0) refuse('ozoneLayer.peak must be ≥ 0', atmosphere)
  return layer
}

/**
 * Checks an atmosphere and returns it with every field set, a copy: the radius and the heights
 * above 0, the scale heights above 0, the anisotropy strictly inside `(−1, 1)`, the colours three
 * finite numbers ≥ 0, the multi-scattering factor in `[0, 100]`. `true` is every default.
 */
export function validateSceneAtmosphere(value: SceneAtmosphere | true): ResolvedAtmosphere {
  const atmosphere: SceneAtmosphere = value === true ? {} : value
  if (typeof atmosphere !== 'object' || atmosphere === null)
    refuse('expects true or an object of settings', value)
  if (!finite(atmosphere.groundHeight ?? 0)) refuse('groundHeight must be finite', atmosphere)
  return {
    planetRadius: number(atmosphere, 'planetRadius', 0, Infinity, true),
    height: number(atmosphere, 'height', 0, Infinity, true),
    groundHeight: atmosphere.groundHeight ?? ATMOSPHERE_DEFAULTS.groundHeight,
    groundAlbedo: colour(atmosphere, 'groundAlbedo'),
    rayleighScattering: colour(atmosphere, 'rayleighScattering'),
    rayleighScaleHeight: number(atmosphere, 'rayleighScaleHeight', 0, Infinity, true),
    mieScattering: colour(atmosphere, 'mieScattering'),
    mieAbsorption: colour(atmosphere, 'mieAbsorption'),
    mieAnisotropy: number(atmosphere, 'mieAnisotropy', -1, 1, true),
    mieScaleHeight: number(atmosphere, 'mieScaleHeight', 0, Infinity, true),
    ozoneAbsorption: colour(atmosphere, 'ozoneAbsorption'),
    ozoneLayer: ozone(atmosphere),
    multiScatteringFactor: number(atmosphere, 'multiScatteringFactor', 0, 100),
    skyLuminanceFactor: colour(atmosphere, 'skyLuminanceFactor'),
    skyAndAerialPerspectiveLuminanceFactor: colour(
      atmosphere,
      'skyAndAerialPerspectiveLuminanceFactor',
    ),
    aerialPerspectiveDistanceScale: number(atmosphere, 'aerialPerspectiveDistanceScale', 0),
    aerialPerspectiveStartDepth: number(atmosphere, 'aerialPerspectiveStartDepth', 0),
    heightFogContribution: number(atmosphere, 'heightFogContribution', 0),
    minSunElevation: number(atmosphere, 'minSunElevation', -90, 90),
    sampleCountScale: sampleScale(atmosphere),
  }
}

/** Every number of an atmosphere, in a fixed order: what two atmospheres are compared by. */
const valuesOf = (a: ResolvedAtmosphere) => [
  a.planetRadius,
  a.height,
  a.groundHeight,
  ...a.groundAlbedo,
  ...a.rayleighScattering,
  a.rayleighScaleHeight,
  ...a.mieScattering,
  ...a.mieAbsorption,
  a.mieAnisotropy,
  a.mieScaleHeight,
  ...a.ozoneAbsorption,
  a.ozoneLayer.altitude,
  a.ozoneLayer.width,
  a.ozoneLayer.peak,
  a.multiScatteringFactor,
  ...a.skyLuminanceFactor,
  ...a.skyAndAerialPerspectiveLuminanceFactor,
  a.aerialPerspectiveDistanceScale,
  a.aerialPerspectiveStartDepth,
  a.heightFogContribution,
  a.minSunElevation,
  a.sampleCountScale,
]

/** True when two validated atmospheres, or their absence, are the same air. */
export function sameSceneAtmosphere(
  a: ResolvedAtmosphere | undefined,
  b: ResolvedAtmosphere | undefined,
) {
  if (a === b) return true
  return !!a && !!b && sameValues(valuesOf(a), valuesOf(b))
}
