import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'
import type { SceneEnvironment } from '../core/environment.ts'
import type { SceneLight } from './contracts.ts'
import {
  atmosphereSunIndexOf,
  DEFAULT_TEMPERATURE_KELVIN,
  diffuseShareOf,
  fogScatteringOf,
  forwardShadingPriorityOf,
  intensityOf,
  inverseSquaredOf,
  innerConeAngleOf,
  lightUnitsOf,
  radialExponentOf,
  shadowResolutionScaleOf,
  specularShareOf,
  mobilityOf,
  shadowsFogOf,
  transmitsOf,
  sunDiskTintOf,
} from './fields.ts'
import { sameSceneFog } from '../core/fog.ts'
import { sameSceneAtmosphere } from '../core/atmosphere.ts'
import {
  lightFunctionDisabledOf,
  lightFunctionFadeOf,
  lightFunctionScaleOf,
} from './lightFunction.ts'
import { sameLightShafts } from './lightShafts.ts'
import { sameLightCloudShadow } from './lightCloudShadow.ts'
import { sameLightShadow } from './lightShadow.ts'
import { sameLightContactShadow } from './lightContactShadow.ts'

/** Two optional contract vectors: both absent, or identical component by component. */
const sameVector = (a: readonly number[] | undefined, b: readonly number[] | undefined) =>
  a === b || (!!a && !!b && sameValues(a, b))

/** Two lights' colour follows the same temperature, and they ask the same of the air: the shade
 *  on it, the transmittance per surface point, the tint of the sun's disk. */
function sameColourAndAir(a: SceneLight, b: SceneLight) {
  return (
    (a.useTemperature === true) === (b.useTemperature === true) &&
    (a.temperatureKelvin ?? DEFAULT_TEMPERATURE_KELVIN) ===
      (b.temperatureKelvin ?? DEFAULT_TEMPERATURE_KELVIN) &&
    (a.shadowsAir === true) === (b.shadowsAir === true) &&
    (a.transmittancePerPixel === true) === (b.transmittancePerPixel === true) &&
    sameVector(sunDiskTintOf(a), sunDiskTintOf(b))
  )
}

/**
 * True when two validated lights describe exactly the same light — arrays included.
 *
 * A mutation that resets already-held values changes nothing in the image: republishing its revision
 * and the store epoch would restart this light's shadow pages and refuse the held
 * frame, for a pixel-identical result. A host that returns its fixed lights every
 * frame — the common case — would thus pay an invalidation per frame and per light.
 *
 * The identifier is not compared: the two lights are those of the same slot. Their contact shadows are
 * not either: they move no shadow page (`sameLightContactShadow`, `setContactShadow`).
 */
export function sameSceneLight(a: SceneLight, b: SceneLight) {
  return sameStrength(a, b) && sameAirAndFunction(a, b) && sameShape(a, b)
}

/** Two lights that are the same in everything a record holds, their contact shadows included: what a writer
 *  of lights compares to know that it has nothing to hand the store (`sameSceneLight` leaves them out). */
export const sameLightRecord = (a: SceneLight, b: SceneLight) =>
  sameSceneLight(a, b) && sameLightContactShadow(a, b)

/** Two lights of the same kind, as strong, in the same unit, scattering and casting alike. */
function sameStrength(a: SceneLight, b: SceneLight) {
  return (
    a.kind === b.kind &&
    intensityOf(a) === intensityOf(b) &&
    lightUnitsOf(a) === lightUnitsOf(b) &&
    a.castsShadow === b.castsShadow &&
    fogScatteringOf(a) === fogScatteringOf(b) &&
    shadowsFogOf(a) === shadowsFogOf(b) &&
    transmitsOf(a) === transmitsOf(b) &&
    mobilityOf(a) === mobilityOf(b) &&
    shadowResolutionScaleOf(a) === shadowResolutionScaleOf(b) &&
    sameLightShadow(a, b) &&
    diffuseShareOf(a) === diffuseShareOf(b) &&
    specularShareOf(a) === specularShareOf(b) &&
    sameVector(a.color, b.color)
  )
}

/** Two lights that ask the same of the air, the shafts, the clouds and the light function. */
function sameAirAndFunction(a: SceneLight, b: SceneLight) {
  return (
    a.atmosphereSun === b.atmosphereSun &&
    sameColourAndAir(a, b) &&
    sameLightShafts(a, b) &&
    sameLightCloudShadow(a, b) &&
    atmosphereSunIndexOf(a) === atmosphereSunIndexOf(b) &&
    forwardShadingPriorityOf(a) === forwardShadingPriorityOf(b) &&
    a.lightFunction === b.lightFunction &&
    lightFunctionFadeOf(a) === lightFunctionFadeOf(b) &&
    lightFunctionDisabledOf(a) === lightFunctionDisabledOf(b) &&
    (a.lightFunctionConeAngle ?? 0) === (b.lightFunctionConeAngle ?? 0) &&
    sameVector(lightFunctionScaleOf(a), lightFunctionScaleOf(b))
  )
}

/** Two lights of the same place, reach, cone, source and fall-off. */
function sameShape(a: SceneLight, b: SceneLight) {
  return (
    a.range === b.range &&
    a.outerConeAngle === b.outerConeAngle &&
    innerConeAngleOf(a) === innerConeAngleOf(b) &&
    a.angularRadius === b.angularRadius &&
    a.emitterRadius === b.emitterRadius &&
    a.emitterLength === b.emitterLength &&
    a.emitterSoftRadius === b.emitterSoftRadius &&
    inverseSquaredOf(a) === inverseSquaredOf(b) &&
    radialExponentOf(a) === radialExponentOf(b) &&
    sameVector(a.position, b.position) &&
    sameVector(a.direction, b.direction) &&
    sameVector(a.right, b.right) &&
    sameVector(a.emitterAxis, b.emitterAxis) &&
    sameVector(a.size, b.size)
  )
}

/** Same rule for the environment: an exposure reset identically stales no frame. */
export function sameSceneEnvironment(a: SceneEnvironment, b: SceneEnvironment) {
  return (
    a.exposure === b.exposure &&
    a.toneMapping === b.toneMapping &&
    a.sharpness === b.sharpness &&
    a.vignette === b.vignette &&
    sameVector(a.irradiance, b.irradiance) &&
    sameSceneFog(a.fog, b.fog) &&
    sameSceneAtmosphere(a.atmosphere, b.atmosphere)
  )
}
