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
import type { LinearRgb } from '../../contracts/material.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import { colourOf, refusal } from './fogChecks.ts'
import { isFiniteNumber } from '../../../../math/src/scalar/reals.ts'

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
  /** Where on the ground plane the planet's top stands, `[x, z]` in scene metres: the sphere's
   *  centre lies under it. `[0, 0]` by default, the planet's top at the world's origin. With
   *  `groundHeight` it places the planet whole, its top at `(x, groundHeight, z)`; a planet that
   *  is to have its centre at a place is given that place with a `groundHeight` its radius over it. */
  groundPosition?: readonly [number, number]
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
  /** How much the haze keeps the light forward, from 0 to 0.999: 0 spreads it evenly. */
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
  /** Whether the sky, the sun's disk and the haze are drawn in the view the camera sees; true by
   *  default. False, the air draws nothing there — the sky is black, the fog alone over it, and the
   *  surfaces and the clouds are not hazed — and the light the air gives (the sun's, tinted by it)
   *  and what the sky light captures of it are as they are. */
  inMainView?: boolean
  /** Whether the sky holds its light out: it draws black and punches a hole in the image's alpha by
   *  its coverage instead of lighting the image, and the haze on the surfaces and the clouds adds no
   *  light. It takes effect with the alpha holdout (`primitiveAlphaHoldout`, `propagateAlpha`,
   *  `../../contracts/filmOptions.ts`); false by default. */
  holdout?: boolean
}

/** An atmosphere with every field set. */
export type ResolvedAtmosphere = Required<SceneAtmosphere> & { ozoneLayer: SceneOzoneLayer }

/** The atmosphere of a scene that sets none of a field: an Earth-like planet. */
const ATMOSPHERE_DEFAULTS: ResolvedAtmosphere = /* @__PURE__ */ (() =>
  Object.freeze({
    planetRadius: 6360,
    height: 60,
    groundHeight: 0,
    groundPosition: Object.freeze([0, 0]) as readonly [number, number],
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
    inMainView: true,
    holdout: false,
  }))()

/** The least scale of the march's samples. */
const LEAST_SAMPLE_SCALE = 0.25
const refuse = /* @__PURE__ */ refusal('atmosphere')

/** The numeric fields a limit applies to. */
type NumberField = Exclude<
  keyof SceneAtmosphere,
  | 'ozoneLayer'
  | 'groundAlbedo'
  | 'groundHeight'
  | 'groundPosition'
  | 'inMainView'
  | 'holdout'
  | LinearField
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
  if (!isFiniteNumber(value) || !inside)
    refuse(`${field} must be in ${open ? `(${min}, ${max})` : `[${min}, ${max}]`}`, atmosphere)
  return value
}

/** A number the field must hold: above 0. */
const positive = (atmosphere: SceneAtmosphere, field: NumberField) =>
  number(atmosphere, field, 0, Infinity, true)

type LinearField =
  | 'rayleighScattering'
  | 'mieScattering'
  | 'mieAbsorption'
  | 'ozoneAbsorption'
  | 'skyLuminanceFactor'
  | 'skyAndAerialPerspectiveLuminanceFactor'

/** A colour of three finite numbers ≥ 0; the field's default when it is absent. */
function colour(atmosphere: SceneAtmosphere, field: LinearField | 'groundAlbedo'): LinearRgb {
  return colourOf(atmosphere[field] ?? ATMOSPHERE_DEFAULTS[field], field, atmosphere, refuse)
}

/** The scale of the march's samples, from `LEAST_SAMPLE_SCALE` with no upper bound. */
function sampleScale(atmosphere: SceneAtmosphere) {
  return number(atmosphere, 'sampleCountScale', LEAST_SAMPLE_SCALE)
}

/** The ozone layer, its fields set. */
function ozone(atmosphere: SceneAtmosphere): SceneOzoneLayer {
  const layer = { ...ATMOSPHERE_DEFAULTS.ozoneLayer, ...atmosphere.ozoneLayer }
  if (!isFiniteNumber(layer.altitude) || layer.altitude < 0)
    refuse('ozoneLayer.altitude must be ≥ 0', atmosphere)
  if (!isFiniteNumber(layer.width) || layer.width < 0)
    refuse('ozoneLayer.width must be ≥ 0', atmosphere)
  if (!isFiniteNumber(layer.peak) || layer.peak < 0)
    refuse('ozoneLayer.peak must be ≥ 0', atmosphere)
  return layer
}

/**
 * Checks an atmosphere and returns it with every field set, a copy: the radius, the height and the
 * scale heights above 0, the anisotropy strictly inside `(−1, 1)`, the haze's start ≥ 0, the colours
 * three finite numbers ≥ 0, the multi-scattering factor in `[0, 100]`. `true` is every default.
 * A height under 0.1 km is read as 0.1 (`atmosphereOptics.ts`). The anisotropy keeps its open bound
 * because the phase function (`hgPhase`) divides `1 − g²` by `(1 + g² + 2 g cosθ)^1.5`: at `|g| = 1`
 * both are 0 along the axis, a 0/0 that is no light; every other value, a haze that scatters back
 * (`g < 0`) among them, is drawn.
 */
export function validateSceneAtmosphere(value: SceneAtmosphere | true): ResolvedAtmosphere {
  const atmosphere: SceneAtmosphere = value === true ? {} : value
  if (typeof atmosphere !== 'object' || atmosphere === null)
    refuse('expects true or an object of settings', value)
  if (!isFiniteNumber(atmosphere.groundHeight ?? 0))
    refuse('groundHeight must be finite', atmosphere)
  if (typeof (atmosphere.inMainView ?? true) !== 'boolean')
    refuse('inMainView must be true or false', atmosphere)
  if (typeof (atmosphere.holdout ?? false) !== 'boolean')
    refuse('holdout must be true or false', atmosphere)
  const place = atmosphere.groundPosition ?? ATMOSPHERE_DEFAULTS.groundPosition
  if (!Array.isArray(place) || place.length !== 2 || !place.every(isFiniteNumber))
    refuse('groundPosition must be two finite numbers, [x, z]', atmosphere)
  return {
    planetRadius: positive(atmosphere, 'planetRadius'),
    height: positive(atmosphere, 'height'),
    groundHeight: atmosphere.groundHeight ?? ATMOSPHERE_DEFAULTS.groundHeight,
    groundPosition: [place[0], place[1]],
    groundAlbedo: colour(atmosphere, 'groundAlbedo'),
    rayleighScattering: colour(atmosphere, 'rayleighScattering'),
    rayleighScaleHeight: positive(atmosphere, 'rayleighScaleHeight'),
    mieScattering: colour(atmosphere, 'mieScattering'),
    mieAbsorption: colour(atmosphere, 'mieAbsorption'),
    mieAnisotropy: number(atmosphere, 'mieAnisotropy', -1, 1, true),
    mieScaleHeight: positive(atmosphere, 'mieScaleHeight'),
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
    inMainView: atmosphere.inMainView ?? ATMOSPHERE_DEFAULTS.inMainView,
    holdout: atmosphere.holdout ?? ATMOSPHERE_DEFAULTS.holdout,
  }
}

/** Every number of an atmosphere, in a fixed order: what two atmospheres are compared by. */
const valuesOf = (a: ResolvedAtmosphere) => [
  a.planetRadius,
  a.height,
  a.groundHeight,
  ...a.groundPosition,
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
  a.inMainView ? 1 : 0,
  a.holdout ? 1 : 0,
]

/** True when two validated atmospheres, or their absence, are the same air. */
export function sameSceneAtmosphere(
  a: ResolvedAtmosphere | undefined,
  b: ResolvedAtmosphere | undefined,
) {
  if (a === b) return true
  return !!a && !!b && sameValues(valuesOf(a), valuesOf(b))
}
