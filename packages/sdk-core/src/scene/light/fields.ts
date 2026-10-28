import { SRGB_LUMINANCE } from '../../../../math/src/color/color.ts'
import { DEG2RAD, TAU } from '../../../../math/src/constants.ts'
import { saturate } from '../../../../math/src/scalar/reals.ts'
import { dotVector3 } from '../../../../math/src/vector/vector.ts'
import { temperatureColour } from '../../modules/sky/sunColour.ts'
import {
  DEFAULT_LIGHTING_CHANNELS_MASK,
  lightingChannelMask,
  storedLightingChannels,
} from '../../contracts/lightingChannelsAbi.ts'
import {
  DEFAULT_LIGHT_MOBILITY,
  LIGHT_CHANNELS_SHIFT,
  LIGHT_FLAG,
  LIGHT_FUNCTION_SHIFT,
  LIGHT_KIND,
  LIGHT_KIND_MARKER,
  LIGHT_PROFILE_SHIFT,
  LIGHT_SETTINGS,
  LIGHT_SHADOWED_SHIFT,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  type AtmosphereSunIndex,
  type LightMobility,
  type SceneLight,
} from './contracts.ts'
import { DEFAULT_LIGHT_UNITS, lampCandelas, lightUnitsFactor } from './lightUnits.ts'
import { contactShadowOfLight } from './lightContactShadow.ts'
import { writeContactShadow, type ContactShadowView } from './contactShadowView.ts'
import { shadowedBitsOf, type LightShadowView } from './shadowedBits.ts'
import { spotAnglesOf } from './spotAngles.ts'
import { profiledIntensityOf } from './lightProfile.ts'
import {
  coneSphereRadius,
  drawShareOf,
  maxDrawDistanceFor,
  type LightRangeView,
} from './drawRange.ts'

/** First float of light `slot` in the packed store. */
export const baseOf = (slot: number) => SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS

/** Field of a light in the buffer, in floats from its base. Eight `vec4f` per light. */
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
  /** Its kind word, a whole number held in the float's bits: its kind's rank plus its flags, its lighting channels stored, its shadowed value,
   *  its profile's atlas slice plus one, whether the view leaves it out and its light function's index, under a constant marker bit
   *  (`LIGHT_KIND`, `LIGHT_FLAG`, `LIGHT_CHANNELS_SHIFT`, `LIGHT_SHADOWED_SHIFT`, `LIGHT_PROFILE_SHIFT`, `LIGHT_UNDRAWN_SHIFT`,
   *  `LIGHT_FUNCTION_SHIFT`, `LIGHT_KIND_MARKER`). */
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
  /** A point or spot's emitter axis, unit: the line its tube lies along, and the one its profile's horizontal angle is read round.
   *  Zero for a light that has neither a tube nor a profile. The tube's length is apart (`tubeHalfLength`). */
  emitterAxis: 20,
  /** A point or spot's soft source radius, in metres; a directional light's, the sine of half its soft angle (`SceneLight.softAngle`). */
  softRadius: 23,
  /** The seventh `vec4f` (`contactGi`): its contact shadow as `writeContactShadow` packs it, then its
   *  indirect lighting factor. */
  contactGi: 24,
  /** The eighth `vec4f` (`traits`) starts here, in `x`: the blend of its strength with the inverse of the exposure (`SceneLight.inverseExposureBlend`),
   *  which the shader applies with the view's exposure where it reads the strength (`lightStrength`). */
  exposureBlend: 28,
  /** In `y`: half the length of a point or spot's tube, centred on the light along its `emitterAxis` — the two ends are the light's place
   *  less and plus the axis times it —, in metres; 0 for a sphere or a point, a profiled one included. */
  tubeHalfLength: 29,
  /** In `z`: for a directional light the sine of its angular radius, which its disk is lit by; for a point or a spot the weight of its
   *  rough diffuse, 1 for a source of no size fading to 0 as its radius or its length reaches `ROUGH_DIFFUSE_FADE_METRES`; 0 for a rect. */
  sourceTerm: 30,
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

/** What a directional light's classic shadow cascades (`SceneLight.dynamicShadowCascades` and the
 *  three fields beside it) are when it names none; the distance in metres. */
export const DEFAULT_CLASSIC_CASCADES = {
  cascades: 4,
  exponent: 3,
  transitionFraction: 0.1,
  distance: 400,
} as const

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

/** The blend of a light's strength with the inverse of the exposure: 0 when it names none. */
export const inverseExposureBlendOf = (light: SceneLight) => light.inverseExposureBlend ?? 0

/** The distance, in metres, past which a light is left out: 0 (no limit) when it names none. */
export const maxDrawDistanceOf = (light: SceneLight) => light.maxDrawDistance ?? 0

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
 * `2π (1 − cos)`, the rect's π. A light whose `useIesBrightness` is on takes its profile's brightness
 * (`iesBrightness`) for its intensity (`profiledIntensityOf`).
 */
export function brightnessOf(light: SceneLight) {
  const intensity = profiledIntensityOf(light, intensityOf(light))
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

/** The mask of the lighting channels a light is in: channel 0 alone when it names none. */
export const lightingChannelMaskOf = (light: SceneLight) =>
  light.lightingChannels
    ? lightingChannelMask(light.lightingChannels)
    : DEFAULT_LIGHTING_CHANNELS_MASK

/** The kind word of a light: its rank, plus the flag of each thing it does (`LIGHT_FLAG`), its lighting channels stored, its shadowed value under
 *  `shadows` (`shadowedBitsOf`, which a light function of `index` without a slot, 0, moves), its `profile` lane (the atlas slice plus one, 0 for
 *  none), the bit that says the view leaves it out (left clear: drawn) and the `index` of its light function (0 for none, a slot of the atlas
 *  otherwise, under `LIGHT_FUNCTION_ENTRIES`), each above the one before (`LIGHT_CHANNELS_SHIFT`), and the marker (`LIGHT_KIND_MARKER`) that
 *  keeps the lane a normal float. The one writer of the word. */
export const kindWordOf = (
  light: SceneLight,
  shadows: LightShadowView,
  index: number,
  profile = 0,
) =>
  (LIGHT_KIND[light.kind] +
    (light.castsShadow ? LIGHT_FLAG.castsShadow : 0) +
    (shadowsFogOf(light) ? LIGHT_FLAG.shadowsFog : 0) +
    (transmitsOf(light) ? LIGHT_FLAG.transmission : 0) +
    (storedLightingChannels(lightingChannelMaskOf(light)) << LIGHT_CHANNELS_SHIFT) +
    (shadowedBitsOf(light, index > 0, shadows.dynamicShadows) << LIGHT_SHADOWED_SHIFT) +
    (profile << LIGHT_PROFILE_SHIFT) +
    index * 2 ** LIGHT_FUNCTION_SHIFT +
    LIGHT_KIND_MARKER) >>>
  0

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

/** What a light's record is written into and folded with (`writeLightFields`): the packed table as floats and as the words its integer
 *  lanes are written through (the same buffer), and the views' settings the record is folded with. */
export interface LightLanes {
  readonly packed: Float32Array
  readonly words: Uint32Array
  readonly contactView: ContactShadowView
  readonly shadowView: LightShadowView
}

/** The size, in metres, past which a light's source takes no rough diffuse: its weight fades from 1 at a point to 0 here. */
const ROUGH_DIFFUSE_FADE_METRES = 0.2

/** The weight of the rough diffuse of a point or a spot (`LIGHT_FIELD.sourceTerm`): 1 for a source of no size, fading to 0 as its radius
 *  or its length reaches `ROUGH_DIFFUSE_FADE_METRES`. */
const roughDiffuseWeightOf = (light: SceneLight) => {
  const size = Math.max(light.emitterRadius ?? 0, light.emitterLength ?? 0)
  return saturate(1 - size * (1 / ROUGH_DIFFUSE_FADE_METRES))
}

/** The term of the light's source in its record (`LIGHT_FIELD.sourceTerm`): a sun's disk's sine, a point or spot's weight of the rough
 *  diffuse, 0 for a rect. */
const sourceTermOf = (light: SceneLight) =>
  light.kind === 'directional'
    ? Math.sin(Math.fround(light.angularRadius ?? LIGHT_SETTINGS.sunAngularRadius))
    : light.kind === 'rect'
      ? 0
      : roughDiffuseWeightOf(light)

/** The radius of the sphere the draw range measures a light by, in metres (`drawShareOf`): its range for a point or a rect; for a spot
 *  the sphere that holds its cone (`coneSphereRadius`). */
function drawRadiusOf(light: SceneLight) {
  const range = light.range ?? 0
  if (light.kind !== 'spot') return range
  return coneSphereRadius(range, Math.cos(spotConesOf(light)[1]))
}

/** Where the draw range of light slot `slot` sits in the table's draw lanes (`writeDrawRange`): the share of the screen per metre of distance
 *  under which a view leaves it out, then the distance past which it does. */
export const DRAW_LANES = 2
export const DRAW_SHARE = 0
export const DRAW_FARTHEST = 1

/** A light's draw range under the view, into the lanes `draw` holds for light slot `slot` (`DRAW_LANES` a slot, the CPU's alone: the shaders read
 *  the decision, in the kind word, `lightDrawn`): the share of the screen per metre of distance under which a view leaves it out
 *  (`drawShareOf`, folded with the view's settings) and the distance past which it does (`maxDrawDistanceFor`; 0 for no limit); both 0 for a
 *  sun, which every view draws. */
export function writeDrawRange(
  draw: Float32Array,
  slot: number,
  light: SceneLight,
  view: LightRangeView,
) {
  const sun = light.kind === 'directional',
    at = slot * DRAW_LANES
  draw[at + DRAW_SHARE] = sun ? 0 : drawShareOf(drawRadiusOf(light), view)
  draw[at + DRAW_FARTHEST] = sun ? 0 : maxDrawDistanceFor(maxDrawDistanceOf(light), view)
}

/**
 * Writes the fields a host declares for one light at `base`, its kind word with the `functionIndex` of its light
 * function and the `profile` lane of its profile (`kindWordOf`; the atlases give them, not the host). The shadow slice is not one: the
 * scheduler sets it. A directional has neither position nor range: its two fields stay zero,
 * and the shader never reads them — it branches on the kind first.
 */
export function writeLightFields(
  into: LightLanes,
  base: number,
  light: SceneLight,
  functionIndex = 0,
  profile = 0,
) {
  const { packed } = into
  writeVector(packed, base + LIGHT_FIELD.position, light.position ?? [0, 0, 0])
  packed[base + LIGHT_FIELD.range] = light.range ?? 0
  writeVector(packed, base + LIGHT_FIELD.color, lightColour(light))
  packed[base + LIGHT_FIELD.intensity] = brightnessOf(light)
  writeVector(packed, base + LIGHT_FIELD.direction, light.direction ?? [0, -1, 0])
  const spot = light.kind === 'spot'
  const [inner, outer] = spot ? spotConesOf(light) : [0, 0]
  packed[base + LIGHT_FIELD.cosCone] = spot ? Math.cos(outer) : NO_CONE
  into.words[base + LIGHT_FIELD.kind] = kindWordOf(light, into.shadowView, functionIndex, profile)
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
  packed[base + LIGHT_FIELD.sourceTerm] = sourceTermOf(light)
  if (light.kind === 'point' || spot) {
    packed[base + LIGHT_FIELD.emitterRadius] = light.emitterRadius ?? 0
    packed[base + LIGHT_FIELD.radialExponent] = inverseSquaredOf(light)
      ? 0
      : radialExponentOf(light)
    writeSource(packed, base, light)
  } else writeSource(packed, base, {})
  if (light.kind === 'directional')
    packed[base + LIGHT_FIELD.softRadius] = Math.sin(0.5 * (light.softAngle ?? 0) * DEG2RAD)
  const at = base + (light.kind === 'rect' ? LIGHT_FIELD.rectShares : LIGHT_FIELD.shares)
  packed[at] = diffuseShareOf(light)
  packed[at + 1] = specularShareOf(light)
  packed[base + LIGHT_FIELD.exposureBlend] = inverseExposureBlendOf(light)
  writeContactGi(packed, base, light, into.contactView)
}

/** A light's contact shadow under the view, and its indirect lighting factor (`LIGHT_FIELD.contactGi`). */
export function writeContactGi(
  packed: Float32Array,
  base: number,
  light: SceneLight,
  view: ContactShadowView,
) {
  const at = base + LIGHT_FIELD.contactGi
  const own = contactShadowOfLight(light)
  writeContactShadow(packed, at, own, view)
  packed[at + 3] = own.indirectLightingIntensity
}

/** A lamp's emitter axis, the half length of its tube and its soft radius (`LIGHT_FIELD.emitterAxis`, `tubeHalfLength`, `softRadius`): the axis
 *  for a light that has a tube or a profile, a unit vector, the half length for a tube alone; zeros for a light with none of them, whatever
 *  its slot held before (a sun's soft radius is written after, `writeLightFields`). */
function writeSource(packed: Float32Array, base: number, light: Partial<SceneLight>) {
  const axis = light.emitterLength !== undefined || light.iesProfile !== undefined
  writeVector(
    packed,
    base + LIGHT_FIELD.emitterAxis,
    axis ? (light.emitterAxis ?? [0, 1, 0]) : [0, 0, 0],
  )
  packed[base + LIGHT_FIELD.tubeHalfLength] = (light.emitterLength ?? 0) / 2
  packed[base + LIGHT_FIELD.softRadius] = light.emitterSoftRadius ?? 0
}
