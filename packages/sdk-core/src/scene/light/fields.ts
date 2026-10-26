import { SRGB_LUMINANCE } from '../../../../math/src/color/color.ts'
import { DEG2RAD, TAU } from '../../../../math/src/constants.ts'
import { dotVector3 } from '../../../../math/src/vector/vector.ts'
import { temperatureColour } from '../../modules/sky/sunColour.ts'
import {
  DEFAULT_LIGHT_MOBILITY,
  LIGHT_FLAG,
  LIGHT_KIND,
  LIGHT_SETTINGS,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  type AtmosphereSunIndex,
  type LightMobility,
  type SceneLight,
} from './contracts.ts'
import { DEFAULT_LIGHT_UNITS, lampCandelas, lightUnitsFactor } from './lightUnits.ts'
import { spotAnglesOf } from './spotAngles.ts'

/** First float of light `slot` in the packed store. */
export const baseOf = (slot: number) => SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS

/** Field of a light in the buffer, in floats from its base. Six `vec4f` per light. */
export const LIGHT_FIELD = {
  /** Where it stands. */
  position: 0,
  /** How far it reaches. */
  range: 3,
  /** Its colour. */
  color: 4,
  /** Its strength. */
  intensity: 7,
  /** Where it points. */
  direction: 8,
  /** Cosine of its cone. */
  cosCone: 11,
  /** Its kind's rank plus its flags (`LIGHT_KIND`, `LIGHT_FLAG`). */
  kind: 12,
  /** Its shadow slot. */
  shadowSlice: 13,
  /** How much of it the volumetric fog and the clouds scatter (`SceneLight.fogScattering`). */
  fogScattering: 14,
  /** A spot's inner cone, where its fade starts: its cosine, 1 for an inner cone of nothing. */
  cosInner: 15,
  /** A rectangle's half-width axis — `right` times half its width —, then half its height. */
  halfWidth: 16,
  /** Half a rectangle's height. */
  halfHeight: 19,
  /** A point or spot's source radius; shares the rectangle-only shape lane. */
  emitterRadius: 16,
  /** A point or spot's exponent where it does not fall off as the inverse square, 0 where it does. */
  radialExponent: 17,
  /** The share of its diffuse light a point, a spot or a directional light gives, then of its
   *  specular light; a rectangle's are `rectShares`. */
  shares: 18,
  /** A rectangle's shares of its diffuse and its specular light: the lanes a lamp's tube leaves. */
  rectShares: 22,
  /** Directional angular radius in radians, sharing the local source-radius lane. */
  angularRadius: 16,
  /** A point or spot's tube: its axis times half its length, centred on the light — the two ends
   *  are the light's place less and plus it —, zero for a sphere or a point. */
  halfAxis: 20,
  /** A point or spot's soft source radius. */
  softRadius: 23,
} as const
/** A point tests no cone, and a spot of no inner cone no inner bound: this cosine never bounds. */
export const NO_CONE = -2

/** The least side of a rectangle light, 1 cm: a smaller one lights and casts as one of 1 cm. */
const RECT_MIN_SIDE = 0.01

/** A rectangle's two sides, width then height, as its lighting and its shadow read them: each at
 *  least `RECT_MIN_SIDE`, the record keeping what the host declared. */
const rectSidesOf = (light: Pick<SceneLight, 'size'>): [number, number] => {
  const [width, height] = light.size!
  return [Math.max(RECT_MIN_SIDE, width), Math.max(RECT_MIN_SIDE, height)]
}

/** The radius of the source its shadow's rays spread over, in metres: a point or a spot's emitter
 *  radius (0 for none), half a rectangle's width. */
export const sourceRadiusOf = (light: SceneLight) =>
  light.kind === 'rect' ? rectSidesOf(light)[0] / 2 : (light.emitterRadius ?? 0)

/** The kelvin of a light that names none: the white of the working space. */
export const DEFAULT_TEMPERATURE_KELVIN = 6500

/** The colour of a light as it lights: the declared colour, multiplied by the colour of a black
 *  body at its temperature where the light asks for it (`SceneLight.useTemperature`). */
export const lightColour = (light: SceneLight) =>
  temperatureColour(light.color, {
    useTemperature: light.useTemperature === true,
    temperatureKelvin: light.temperatureKelvin ?? DEFAULT_TEMPERATURE_KELVIN,
  })

/** The share of its diffuse light a light gives: 1 when it names none. */
export const diffuseShareOf = (light: SceneLight) => light.diffuseShare ?? 1

/** The share of its specular light a light gives: 1 when it names none. */
export const specularShareOf = (light: SceneLight) => light.specularShare ?? 1

/** Whether a point or spot falls off as the inverse square of the distance: it does when it names
 *  nothing else. */
export const inverseSquaredOf = (light: SceneLight) => light.inverseSquared ?? true

/** The exponent of a point or spot's fall-off where it is not the inverse square: 8 by default. */
export const radialExponentOf = (light: SceneLight) =>
  light.radialExponent ?? LIGHT_SETTINGS.radialExponent

/** A spot's outer cone half-angle when it names none: 44°. */
export const DEFAULT_OUTER_CONE_ANGLE = /* @__PURE__ */ (() => 44 * DEG2RAD)()

/** A spot's inner cone half-angle when it names none: nothing, the light fades across the whole
 *  cone. */
export const DEFAULT_INNER_CONE_ANGLE = 0

/** A spot's inner cone half-angle as it declares it. */
export const innerConeAngleOf = (light: Pick<SceneLight, 'innerConeAngle'>) =>
  light.innerConeAngle ?? DEFAULT_INNER_CONE_ANGLE

/** A spot's cone half-angles as it is lit: its inner and outer cones held apart by a gap
 *  (`spotAnglesOf`). */
export const spotConesOf = (light: SceneLight) =>
  spotAnglesOf(innerConeAngleOf(light), light.outerConeAngle!)

/** A directional light's intensity when it names none: 10 lux. */
const DEFAULT_SUN_INTENSITY = 10
/** A point, spot or rect light's intensity when it names none, before its unit: 5000 unitless,
 *  8 candelas. */
const DEFAULT_LAMP_UNITLESS = 5000

/** The unit a point, spot or rect light's intensity is written in: unitless when it names none. */
export const lightUnitsOf = (light: Pick<SceneLight, 'intensityUnits'>) =>
  light.intensityUnits ?? DEFAULT_LIGHT_UNITS

/** The fields of a lamp its default intensity and its brightness read beside its unit. */
type LampShape = Pick<
  SceneLight,
  | 'kind'
  | 'intensityUnits'
  | 'outerConeAngle'
  | 'innerConeAngle'
  | 'inverseSquared'
  | 'emitterRadius'
  | 'emitterLength'
  | 'size'
>

/** The half-angle cosine of the cone a lamp's lumen spreads over: a point's whole sphere (−1), a
 *  spot's outer cone, a rect's cosine lobe (0.5, a solid angle of π). */
function lumenCosine(light: LampShape) {
  if (light.kind === 'rect') return 0.5
  if (light.kind !== 'spot') return -1
  return Math.cos(
    spotAnglesOf(innerConeAngleOf(light), light.outerConeAngle ?? DEFAULT_OUTER_CONE_ANGLE)[1],
  )
}

/** The area, in square metres, a lamp's nit is worth: a point or spot's sphere or capsule,
 *  `4π r (r + length / 2)` (0 for a point source), a rect's face as it lights. */
export function sourceAreaOf(light: LampShape) {
  if (light.kind === 'rect') {
    const [width, height] = rectSidesOf(light)
    return width * height
  }
  const radius = light.emitterRadius ?? 0
  return 2 * TAU * radius * (radius + 0.5 * (light.emitterLength ?? 0))
}

/** Whether a lamp's intensity is read in its unit: a rect's always, a point or spot's under the
 *  inverse square; off it, the intensity is a brightness scale in no unit. */
export const readsUnits = (light: Pick<SceneLight, 'kind' | 'inverseSquared'>) =>
  light.kind === 'rect' || (light.kind !== 'directional' && light.inverseSquared !== false)

/**
 * The intensity of a light that names none: a directional light's 10 lux; a lamp's the light a new
 * one is placed with, 5000 unitless taken to its unit. In candelas, lumens and unitless, the units
 * a project places lamps in, by the conversion factor (`lightUnitsFactor`): 8 candelas. In EV and
 * nits, which a lamp reaches by a change of unit that keeps its light, the same 8 candelas: an EV
 * of `log2 8` = 3, `8 / area` nits — under the inverse square; off it the number is kept, 8.
 */
export function defaultIntensityOf(light: LampShape) {
  if (light.kind === 'directional') return DEFAULT_SUN_INTENSITY
  const units = lightUnitsOf(light)
  const cos = lumenCosine(light)
  if (units !== 'ev' && units !== 'nits')
    return DEFAULT_LAMP_UNITLESS * lightUnitsFactor('unitless', units, cos)
  const candelas = DEFAULT_LAMP_UNITLESS * lightUnitsFactor('unitless', 'candelas', cos)
  if (!readsUnits(light)) return candelas
  return units === 'ev' ? Math.log2(candelas) : candelas / sourceAreaOf(light)
}

/** A light's intensity, in its unit: the declared one, or its kind's default. */
export const intensityOf = (light: SceneLight) => light.intensity ?? defaultIntensityOf(light)

/**
 * The number the GPU holds for a light's strength, from its intensity and its unit: a directional
 * light's lux; a point or spot's candelas where it falls off as the inverse square, its intensity
 * as it is where it does not; a rect's radiance, its candelas over half its face's area. A nit is
 * worth the source's area (`sourceAreaOf`); a lumen the sphere's 4π, the spot's cone
 * `2π (1 − cos)`, the rect's π.
 */
export function brightnessOf(light: SceneLight) {
  const intensity = intensityOf(light)
  if (!readsUnits(light)) return intensity
  const candelas = lampCandelas(
    intensity,
    lightUnitsOf(light),
    sourceAreaOf(light),
    TAU * (1 - lumenCosine(light)),
  )
  if (light.kind !== 'rect') return candelas
  const [width, height] = rectSidesOf(light)
  return candelas / (0.5 * width * height)
}

/** The luminance of a light: its colour (with its temperature) times its brightness, each channel
 *  weighed by the eye's sensitivity to it (the working space's weights): what picks the sun of the
 *  air among the directional lights (`atmosphereSun.ts`), and what the fog's sun scatters
 *  (`fogSun.ts`). */
export const lightLuminance = (light: SceneLight) =>
  brightnessOf(light) * dotVector3(SRGB_LUMINANCE, lightColour(light))

/** The colour a sun's disk is multiplied by: white when it names none. */
export const sunDiskTintOf = (light: SceneLight): [number, number, number] =>
  light.sunDiskTint ?? [1, 1, 1]

/** How much of a light the volumetric fog and the clouds scatter: 1 when it names none. */
export const fogScatteringOf = (light: SceneLight) => light.fogScattering ?? 1

/** Whether a light's shadow also shadows the volumetric fog: a directional light's by default, a
 *  local light's only when asked. */
export const shadowsFogOf = (light: SceneLight) => light.shadowsFog ?? light.kind === 'directional'

/** Whether a light shines through the subsurface-profile surfaces it shadows: it asks for it
 *  (`transmission`), casts a shadow, and moves (`movable`): a light baked or held still has its
 *  shadow in the lightmaps, which carry no thickness. */
export const transmitsOf = (light: SceneLight) =>
  light.transmission === true && light.castsShadow && mobilityOf(light) === 'movable'

/** The mobility of a light: `stationary` when it names none (`DEFAULT_LIGHT_MOBILITY`). */
export const mobilityOf = (light: SceneLight): LightMobility =>
  light.mobility ?? DEFAULT_LIGHT_MOBILITY

/** The factor on the resolution a light's shadow is given: 1 when it names none. */
export const shadowResolutionScaleOf = (light: SceneLight) => light.shadowResolutionScale ?? 1

/** The kind word of a light: its rank, plus the flag of each thing it does (`LIGHT_FLAG`). */
const kindWordOf = (light: SceneLight) =>
  LIGHT_KIND[light.kind] +
  (light.castsShadow ? LIGHT_FLAG.castsShadow : 0) +
  (shadowsFogOf(light) ? LIGHT_FLAG.shadowsFog : 0) +
  (transmitsOf(light) ? LIGHT_FLAG.transmission : 0)

/** The air's light a directional light is a candidate for: its `atmosphereSunIndex`, 0 absent. */
export const atmosphereSunIndexOf = (light: SceneLight): AtmosphereSunIndex =>
  light.atmosphereSunIndex ?? 0

/** The priority of a directional light for the forward light (`forwardLight.ts`): 0 absent. */
export const forwardShadingPriorityOf = (light: SceneLight) => light.forwardShadingPriority ?? 0

function writeVector(packed: Float32Array, at: number, value: readonly number[]) {
  packed[at] = value[0]
  packed[at + 1] = value[1]
  packed[at + 2] = value[2]
}

/**
 * Writes the fields a host declares for one light at `base`. The shadow slice is not one: the
 * scheduler sets it. A directional has neither position nor range: its two fields stay zero,
 * and the shader never reads them — it branches on the kind first.
 */
export function writeLightFields(packed: Float32Array, base: number, light: SceneLight) {
  writeVector(packed, base + LIGHT_FIELD.position, light.position ?? [0, 0, 0])
  packed[base + LIGHT_FIELD.range] = light.range ?? 0
  writeVector(packed, base + LIGHT_FIELD.color, lightColour(light))
  packed[base + LIGHT_FIELD.intensity] = brightnessOf(light)
  writeVector(packed, base + LIGHT_FIELD.direction, light.direction ?? [0, -1, 0])
  const spot = light.kind === 'spot'
  const [inner, outer] = spot ? spotConesOf(light) : [0, 0]
  packed[base + LIGHT_FIELD.cosCone] = spot ? Math.cos(outer) : NO_CONE
  packed[base + LIGHT_FIELD.kind] = kindWordOf(light)
  packed[base + LIGHT_FIELD.fogScattering] = fogScatteringOf(light)
  packed[base + LIGHT_FIELD.cosInner] = spot ? Math.cos(inner) : NO_CONE
  const [width, height] = light.size ? rectSidesOf(light) : [0, 0]
  writeVector(
    packed,
    base + LIGHT_FIELD.halfWidth,
    (light.right ?? [0, 0, 0]).map((c) => (c * width) / 2),
  )
  packed[base + LIGHT_FIELD.halfHeight] = height / 2
  if (light.kind === 'directional')
    packed[base + LIGHT_FIELD.angularRadius] =
      light.angularRadius ?? LIGHT_SETTINGS.sunAngularRadius
  if (light.kind === 'point' || spot) {
    packed[base + LIGHT_FIELD.emitterRadius] = light.emitterRadius ?? 0
    packed[base + LIGHT_FIELD.radialExponent] = inverseSquaredOf(light)
      ? 0
      : radialExponentOf(light)
    writeSource(packed, base, light)
  } else writeSource(packed, base, {})
  const at = base + (light.kind === 'rect' ? LIGHT_FIELD.rectShares : LIGHT_FIELD.shares)
  packed[at] = diffuseShareOf(light)
  packed[at + 1] = specularShareOf(light)
}

/** A lamp's tube and soft radius (`LIGHT_FIELD.halfAxis`, `softRadius`): zero for a light with
 *  neither, whatever its slot held before. */
function writeSource(packed: Float32Array, base: number, light: Partial<SceneLight>) {
  const half = (light.emitterLength ?? 0) / 2
  writeVector(
    packed,
    base + LIGHT_FIELD.halfAxis,
    (light.emitterAxis ?? [0, 1, 0]).map((c) => c * half),
  )
  packed[base + LIGHT_FIELD.softRadius] = light.emitterSoftRadius ?? 0
}
