import { DEFAULT_LIGHT_MOBILITY, type SceneLight } from '../../scene/light/contracts.ts'
import { DEFAULT_LIGHTING_CHANNELS } from '../../contracts/lightingChannelsAbi.ts'
import {
  addHemisphereIrradiance,
  addIrradianceCoefficients,
  addUniformIrradiance,
  type IrradianceSum,
} from '../../scene/core/environment.ts'
import { DEFAULT_INNER_CONE_ANGLE, readsUnits } from '../../scene/light/fields.ts'
import { Vector3 } from '../math/vector3.ts'
import { Light } from './light.ts'
import * as lightFunction from './lightFunctionSettings.ts'
import * as lightShaft from './lightShaftSettings.ts'
import * as lightCloudShadow from './lightCloudShadowSettings.ts'
import * as lightShadow from './lightShadowSettings.ts'
import * as lightContactShadow from './lightContactShadowSettings.ts'
import { recordColourAndAir } from './lightAirSettings.ts'
import {
  localNumbersOf,
  recordLocalNumbers,
  recordFalloff,
  recordShares,
  recordUnits,
} from './lightLampSettings.ts'
import { storeKindOf } from './lightNumbers.ts'
import { HALF_PI } from '../../../../math/src/constants.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'

/** The kinds that are lamps — a position or a direction the engine's light store holds. */
const LAMPS = new Set(['point', 'spot', 'directional', 'rectArea'])
/** The store's spot cone is open on `(0, π/2)`: the widest half-angle it holds, the half-space
 *  less the one float the bound excludes. */
const WIDEST_CONE = HALF_PI - 1e-9
const eye = new Vector3(),
  aim = new Vector3(),
  right = new Vector3()
/** The scene's up, which a tube lies along while its node is not turned. */
const UP = new Vector3(0, 1, 0)
/** `colour` times `scale`: read when the lights change, never per frame. */
const scaled = (colour: { r: number; g: number; b: number }, scale: number) => [
  colour.r * scale,
  colour.g * scale,
  colour.b * scale,
]

/** Whether a lamp gives light: its intensity above 0, or any finite one in EV where its unit is
 *  read (`2^ev` candelas; `readsUnits`: a rectangle, or a point or spot under the inverse square). */
const givesLight = (light: Light) =>
  light.intensityUnits === 'ev' &&
  readsUnits({ kind: storeKindOf(light.kind)!, inverseSquared: light.inverseSquared })
    ? Number.isFinite(light.intensity)
    : light.intensity > 0

/**
 * A lamp as the engine's store holds it (`scene/light/contracts.ts`), placed by its world matrix,
 * or null for a kind the store does not hold or a light giving nothing. Whether it is shown — it
 * and every node above it visible — is the caller's to decide (`world/lights.ts`). `range` is the
 * page's `distance`, or `reach` — what the world derives from its own extent seen from the lamp's
 * world position, asked only of a lamp the page left unbounded.
 *
 * A rectangle (`rectArea`) is the store's `rect`: its `intensity` in its `intensityUnits`, its face
 * looking down the light's `-z`, its width along the light's `x`; it casts a shadow where its `castShadow` is set.
 */
export function lampRecord(
  light: Light,
  id: string,
  reach: (at: Vector3) => number,
): SceneLight | null {
  if (!LAMPS.has(light.kind) || !givesLight(light)) return null
  const rectangle = light.kind === 'rectArea'
  const kind = rectangle ? 'rect' : (light.kind as SceneLight['kind'])
  light.getWorldPosition(eye)
  const record: SceneLight = {
    id,
    kind,
    color: light.color.toArray(),
    intensity: light.intensity,
    castsShadow: light.castShadow,
  }
  if (light.fogScattering !== 1) record.fogScattering = light.fogScattering
  if (kind !== 'directional' && light.shadowResolutionScale !== 1)
    record.shadowResolutionScale = light.shadowResolutionScale
  recordShares(light, record)
  recordLocalNumbers(light, record)
  recordUnits(light, record)
  recordColourAndAir(light, record)
  if (light.shadowsFog !== (kind === 'directional')) record.shadowsFog = light.shadowsFog
  if (light.mobility !== DEFAULT_LIGHT_MOBILITY) record.mobility = light.mobility
  if (light.lightingChannels !== DEFAULT_LIGHTING_CHANNELS)
    record.lightingChannels = light.lightingChannels
  lightFunction.record(light, record)
  Object.assign(
    record,
    lightShaft.settingsSet(light),
    lightCloudShadow.settingsSet(light),
    lightShadow.settingsSet(light),
    lightContactShadow.settingsSet(light),
  )
  recordFacing(light, record, kind, rectangle)
  if (kind === 'directional') {
    recordSun(light, record)
    return record
  }
  record.position = eye.toArray()
  record.range = light.distance > 0 ? light.distance : reach(eye)
  if (kind === 'spot') recordCone(light, record)
  if (!rectangle) writeLamp(record, light, record.range)
  return record
}

/** A rectangle's right axis and size, and the direction of every kind but a point: toward its
 *  target, or its own `-z` for a rectangle, straight down when they coincide. */
function recordFacing(
  light: Light,
  record: SceneLight,
  kind: SceneLight['kind'],
  rectangle: boolean,
) {
  if (rectangle) {
    light.getWorldDirection(aim)
    const m = light.matrixWorld.elements
    record.right = right.set(m[0], m[1], m[2]).normalize().toArray()
    record.size = [light.width, light.height]
  }
  if (kind !== 'point') {
    if (!rectangle) light.target.getWorldPosition(aim).sub(eye)
    record.direction = (aim.lengthSq() > 0 ? aim.normalize() : aim.set(0, -1, 0)).toArray()
  }
}

/** What only a directional light records: its angular radius, its atmosphere sun and its priority. */
function recordSun(light: Light, record: SceneLight) {
  if (light.angularRadius > 0) record.angularRadius = light.angularRadius
  if (light.softAngle > 0) record.softAngle = light.softAngle
  if (!light.atmosphereSun) record.atmosphereSun = false
  if (light.atmosphereSunIndex !== 0) record.atmosphereSunIndex = light.atmosphereSunIndex
  if (light.forwardShadingPriority !== 0)
    record.forwardShadingPriority = light.forwardShadingPriority
}

/** A spot's outer cone, and its inner one where it is not the default. */
function recordCone(light: Light, record: SceneLight) {
  record.outerConeAngle = Math.min(light.outerConeAngle, WIDEST_CONE)
  if (light.innerConeAngle !== DEFAULT_INNER_CONE_ANGLE)
    record.innerConeAngle = clamp(light.innerConeAngle, 0, WIDEST_CONE)
}

/** A point or spot's source and fall-off: its radius and soft radius, each only below the range as
 *  the record holds them, its tube along the light's own up in the world (the node's local y), the
 *  way its light falls off. */
function writeLamp(record: SceneLight, light: Light, range: number) {
  recordFalloff(light, record)
  if (light.radius > 0 && light.radius < range) record.emitterRadius = light.radius
  if (light.softRadius > 0 && light.softRadius < range) record.emitterSoftRadius = light.softRadius
  if (!(light.tubeLength > 0)) return
  const m = light.matrixWorld.elements
  record.emitterLength = light.tubeLength
  record.emitterAxis = right.set(m[4], m[5], m[6]).normalize().toArray()
}

/**
 * Adds what `light` gives from every direction — its irradiance, a function of the normal alone —
 * to the nine coefficients `sh` (`scene/core/environment.ts`): an ambient its colour times
 * intensity everywhere; a sky over a ground (`hemisphere`) its colour on normals toward its
 * position seen from the origin and `groundColor` on the opposite ones; a probe its coefficients,
 * or its colour everywhere when it carries none. A lamp adds nothing here, nor does a sky light: the
 * sky module's sky light lights the scene by the cube it captures (`modules/sky/skyLight`). Whether the
 * light is shown is the caller's to decide, as for `lampRecord`. Returns whether it added anything.
 */
export function addLightIrradiance(light: Light, sh: IrradianceSum) {
  if (!(light.intensity > 0)) return false
  const scale = light.intensity
  if (light.kind === 'probe' && light.sh) addIrradianceCoefficients(sh, light.sh, scale)
  else if (light.kind === 'ambient' || light.kind === 'probe')
    addUniformIrradiance(sh, scaled(light.color, scale))
  else if (light.kind === 'hemisphere') {
    light.getWorldPosition(aim)
    if (!(aim.lengthSq() > 0)) aim.set(0, 1, 0)
    const ground = light.groundColor.toArray().map((c) => c * scale)
    addHemisphereIrradiance(sh, scaled(light.color, scale), ground, aim.normalize().toArray())
  } else return false
  return true
}

/** The core light kind of a store lamp's kind: the store's `rect` is a `rectArea`. */
const lightKindOf = (kind: SceneLight['kind']) => (kind === 'rect' ? 'rectArea' : kind)

/**
 * The node of a lamp the engine's store describes — a light the source file carried — which a
 * page then edits, moves or removes like one of its own: same kind, colour, intensity, range and
 * cone, its target one unit along its direction.
 */
export function lightFromRecord(record: SceneLight): Light {
  const along = record.direction ?? [0, -1, 0]
  const at = record.position ?? [-along[0], -along[1], -along[2]]
  const node = new Light(lightKindOf(record.kind), {
    width: record.size?.[0],
    height: record.size?.[1],
    color: record.color,
    intensity: record.intensity,
    intensityUnits: record.intensityUnits,
    castShadow: record.castsShadow,
    position: at,
    target: [at[0] + along[0], at[1] + along[1], at[2] + along[2]],
    distance: record.range,
    innerConeAngle: record.innerConeAngle,
    outerConeAngle: record.outerConeAngle,
    radius: record.emitterRadius,
    angularRadius: record.angularRadius,
    softAngle: record.softAngle,
    atmosphereSun: record.atmosphereSun,
    atmosphereSunIndex: record.atmosphereSunIndex,
    forwardShadingPriority: record.forwardShadingPriority,
    useTemperature: record.useTemperature,
    temperatureKelvin: record.temperatureKelvin,
    shadowsAir: record.shadowsAir,
    transmittancePerPixel: record.transmittancePerPixel,
    transmission: record.transmission,
    sunDiskTint: record.sunDiskTint,
    fogScattering: record.fogScattering,
    shadowResolutionScale: record.shadowResolutionScale,
    shadowsFog: record.shadowsFog,
    mobility: record.mobility,
    lightingChannels: record.lightingChannels,
    softRadius: record.emitterSoftRadius,
    tubeLength: record.emitterLength,
    inverseSquared: record.inverseSquared,
    radialExponent: record.radialExponent,
    diffuseShare: record.diffuseShare,
    specularShare: record.specularShare,
    ...localNumbersOf(record),
    ...lightShaft.fromRecord(record),
    ...lightCloudShadow.fromRecord(record),
    ...lightShadow.fromRecord(record),
    ...lightContactShadow.fromRecord(record),
  })
  node.name = record.id
  // A tube lies along the node's own up: turned there from the scene's.
  if (record.emitterAxis) node.quaternion.setFromUnitVectors(UP, aim.set(...record.emitterAxis))
  return node
}
