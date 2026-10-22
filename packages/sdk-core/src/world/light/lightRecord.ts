import type { SceneLight } from '../../scene/light/contracts.ts'
import {
  addHemisphereIrradiance,
  addIrradianceCoefficients,
  addUniformIrradiance,
  type IrradianceSum,
} from '../../scene/core/environment.ts'
import { SHADOW_DISTANCE_DEFAULT } from '../../contracts/shadowOptions.ts'
import { Vector3 } from '../math/vector3.ts'
import { Light } from './light.ts'
import { HALF_PI } from '../../../../math/src/constants.ts'

/** The kinds that are lamps — a position or a direction the engine's light store holds. */
const LAMPS = new Set(['point', 'spot', 'directional', 'rectArea'])
/** A lamp that asks to cast and whose kind the store lets cast: a rectangle casts none. */
export const lampCastsShadow = (light: Light) =>
  light.castShadow && LAMPS.has(light.kind) && light.kind !== 'rectArea'
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

/**
 * A lamp as the engine's store holds it (`scene/light/contracts.ts`), placed by its world matrix,
 * or null for a kind the store does not hold or a light giving nothing. Whether it is shown — it
 * and every node above it visible — is the caller's to decide (`world/lights.ts`). `range` is the
 * page's `distance`, or `reach` — what the world derives from its own extent seen from the lamp's
 * world position, asked only of a lamp the page left unbounded.
 *
 * A rectangle (`rectArea`) is the store's `rect`: its radiance `intensity`, its face looking down
 * the light's `-z`, its width along the light's `x`, and no cast shadow — the store refuses one.
 */
export function lampRecord(
  light: Light,
  id: string,
  reach: (at: Vector3) => number,
): SceneLight | null {
  if (!LAMPS.has(light.kind) || !(light.intensity > 0)) return null
  const rectangle = light.kind === 'rectArea'
  const kind = rectangle ? 'rect' : (light.kind as SceneLight['kind'])
  light.getWorldPosition(eye)
  const record: SceneLight = {
    id,
    kind,
    color: light.color.toArray(),
    intensity: light.intensity,
    castsShadow: lampCastsShadow(light),
  }
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
  if (kind === 'directional') {
    if (light.angularRadius > 0) record.angularRadius = light.angularRadius
    if (!light.atmosphereSun) record.atmosphereSun = false
    if (light.atmosphereSunIndex !== 0) record.atmosphereSunIndex = light.atmosphereSunIndex
    // The default distance stays out of the record, as the default disk does: a light that names
    // none keeps the record it had.
    if (light.shadowDistance !== SHADOW_DISTANCE_DEFAULT)
      record.shadowDistance = light.shadowDistance
    return record
  }
  record.position = eye.toArray()
  record.range = light.distance > 0 ? light.distance : reach(eye)
  if (kind === 'spot') {
    record.coneAngle = Math.min(light.angle, WIDEST_CONE)
    if (light.penumbra > 0) record.penumbra = Math.min(1, light.penumbra)
  }
  if (!rectangle) writeSource(record, light, record.range)
  return record
}

/** A point or spot's source: its radius and soft radius, each only below the range as the record
 *  holds them, and its tube along the light's own up in the world (the node's local y). */
function writeSource(record: SceneLight, light: Light, range: number) {
  if (light.radius > 0 && light.radius < range) record.emitterRadius = light.radius
  if (light.softRadius > 0 && light.softRadius < range) record.emitterSoftRadius = light.softRadius
  if (!(light.tubeLength > 0)) return
  const m = light.matrixWorld.elements
  record.emitterLength = light.tubeLength
  record.emitterAxis = right.set(m[4], m[5], m[6]).normalize().toArray()
}

/** What a sky light sees of the sky: the atmosphere's radiance as the engine captured it — nine
 *  coefficients of it, none yet — when the scene has an atmosphere, else the flat colour behind
 *  the scene, linear. */
export interface SkySource {
  /** Whether the scene has an atmosphere: the sky is then the captured one. */
  atmosphere: boolean
  /** The radiance coefficients of the atmosphere's upper sky (27 numbers), once captured. */
  captured?: ArrayLike<number>
  /** The scene's background colour, linear: the sky of a scene without an atmosphere. */
  background: readonly number[]
}

/** The axis a sky light's two halves are cut along: the scene's up. */
const ZENITH = [0, 1, 0]

/** A sky light's irradiance: the sky above, its `groundColor` below. The captured atmosphere is
 *  radiance coefficients (`addIrradianceCoefficients` lays them in, a colour's channels scaling
 *  each); a flat sky is a hemisphere of that radiance, `π L` of irradiance on a normal facing it. */
function addSkyIrradiance(light: Light, sh: IrradianceSum, source: SkySource) {
  const { intensity, color } = light
  const tint = [color.r * intensity, color.g * intensity, color.b * intensity]
  const lower = light.groundColor.toArray().map((c) => c * intensity * Math.PI)
  if (!source.atmosphere) {
    const upper = source.background.map((c, i) => c * tint[i] * Math.PI)
    addHemisphereIrradiance(sh, upper, lower, ZENITH)
    return
  }
  const { captured } = source
  if (captured) for (let k = 0; k < captured.length; k++) sh[k] += captured[k] * tint[k % 3]
  addHemisphereIrradiance(sh, [0, 0, 0], lower, ZENITH)
}

/**
 * Adds what the sky light `light` shows a ray that leaves the scene to `upper` and `lower`, three
 * numbers each (`SceneSky`): above the horizon its colour times its intensity — a factor of the
 * atmosphere's sky, or with no atmosphere that factor of the sky's own colour, the background —,
 * below it its `groundColor` times its intensity (black by default). Returns whether it added any:
 * not a sky light, or one giving nothing, adds none.
 */
export function addSkyRadiance(light: Light, source: SkySource, upper: number[], lower: number[]) {
  if (light.kind !== 'sky' || !(light.intensity > 0)) return false
  const { intensity, color, groundColor } = light
  const tint = [color.r * intensity, color.g * intensity, color.b * intensity]
  const ground = groundColor.toArray()
  for (let c = 0; c < 3; c++) {
    upper[c] += source.atmosphere ? tint[c] : source.background[c] * tint[c]
    lower[c] += ground[c] * intensity
  }
  return true
}

/**
 * Adds what `light` gives from every direction — its irradiance, a function of the normal alone —
 * to the nine coefficients `sh` (`scene/core/environment.ts`): an ambient its colour times
 * intensity everywhere; a sky over a ground (`hemisphere`) its colour on normals toward its
 * position seen from the origin and `groundColor` on the opposite ones; a probe its coefficients,
 * or its colour everywhere when it carries none; a sky light the sky `sky` describes above and
 * its `groundColor` below (black by default). A lamp adds nothing here; whether the light is
 * shown is the caller's to decide, as for `lampRecord`. Returns whether it added anything.
 */
export function addLightIrradiance(light: Light, sh: IrradianceSum, sky?: SkySource) {
  if (!(light.intensity > 0)) return false
  const scale = light.intensity
  if (light.kind === 'sky') {
    if (!sky) return false
    addSkyIrradiance(light, sh, sky)
  } else if (light.kind === 'probe' && light.sh) addIrradianceCoefficients(sh, light.sh, scale)
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
    castShadow: record.castsShadow,
    position: at,
    target: [at[0] + along[0], at[1] + along[1], at[2] + along[2]],
    distance: record.range,
    angle: record.coneAngle,
    penumbra: record.penumbra,
    radius: record.emitterRadius,
    angularRadius: record.angularRadius,
    shadowDistance: record.shadowDistance,
    atmosphereSun: record.atmosphereSun,
    atmosphereSunIndex: record.atmosphereSunIndex,
    softRadius: record.emitterSoftRadius,
    tubeLength: record.emitterLength,
  })
  node.name = record.id
  // A tube lies along the node's own up: turned there from the scene's.
  if (record.emitterAxis) node.quaternion.setFromUnitVectors(UP, aim.set(...record.emitterAxis))
  return node
}
