import { SRGB_LUMINANCE } from '../../../../math/src/color/color.ts'
import { dotVector3 } from '../../../../math/src/vector/vector.ts'
import {
  LIGHT_KIND,
  LIGHT_SETTINGS,
  SCENE_LIGHT_FLOATS,
  SCENE_LIGHT_HEADER_FLOATS,
  type AtmosphereSunIndex,
  type SceneLight,
} from './contracts.ts'

/** First float of light `slot` in the packed store. */
export const baseOf = (slot: number) => SCENE_LIGHT_HEADER_FLOATS + slot * SCENE_LIGHT_FLOATS

/** Field of a light in the buffer, in floats from its base. Seven `vec4f` per light. */
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
  /** Its kind. */
  kind: 12,
  /** Its shadow slot. */
  shadowSlice: 13,
  /** Whether it casts shadows. */
  castsShadow: 14,
  /** A spot's inner cone, where its penumbra starts: the cone's own edge when it has none. */
  cosInner: 15,
  /** A rectangle's half-width axis — `right` times half its width —, then half its height. */
  halfWidth: 16,
  /** Half a rectangle's height. */
  halfHeight: 19,
  /** A point or spot's source radius; shares the rectangle-only shape lane. */
  emitterRadius: 16,
  /** Directional angular radius in radians, sharing the local source-radius lane. */
  angularRadius: 16,
  /** A point or spot's tube: its axis times half its length, centred on the light — the two ends
   *  are the light's place less and plus it —, zero for a sphere or a point. */
  halfAxis: 20,
  /** A point or spot's soft source radius. */
  softRadius: 23,
} as const
/** A point tests no cone, and a spot without penumbra no inner cone: this cosine never bounds. */
export const NO_CONE = -2

/** The luminance of a light: its colour times its intensity, each channel weighed by the eye's
 *  sensitivity to it (the working space's weights): what picks the sun of the air among the
 *  directional lights (`atmosphereSun.ts`), and what the fog's sun scatters (`fogSun.ts`). */
export const lightLuminance = (light: SceneLight) =>
  light.intensity * dotVector3(SRGB_LUMINANCE, light.color)

/** The air's light a directional light is a candidate for: its `atmosphereSunIndex`, 0 absent. */
export const atmosphereSunIndexOf = (light: SceneLight): AtmosphereSunIndex =>
  light.atmosphereSunIndex ?? 0

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
  writeVector(packed, base + LIGHT_FIELD.color, light.color)
  packed[base + LIGHT_FIELD.intensity] = light.intensity
  writeVector(packed, base + LIGHT_FIELD.direction, light.direction ?? [0, -1, 0])
  const spot = light.kind === 'spot'
  packed[base + LIGHT_FIELD.cosCone] = spot ? Math.cos(light.coneAngle!) : NO_CONE
  packed[base + LIGHT_FIELD.kind] = LIGHT_KIND[light.kind]
  packed[base + LIGHT_FIELD.castsShadow] = light.castsShadow ? 1 : 0
  packed[base + LIGHT_FIELD.cosInner] =
    spot && light.penumbra ? Math.cos(light.coneAngle! * (1 - light.penumbra)) : NO_CONE
  const [width, height] = light.size ?? [0, 0]
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
    writeSource(packed, base, light)
  } else writeSource(packed, base, {})
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
