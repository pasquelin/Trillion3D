// Generated lights of every kind and points on each side of each edge of their reach
// (`lightReach.test.ts`): the range, a spot's cone, a rectangle's plane; a sun reaches every point.
import type { SceneLight } from '../../../../sdk-core/src/index.ts'
import { SCENE_LIGHT_FLOATS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { writeLightFields } from '../../../../sdk-core/src/scene/light/fields.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

export type V3 = [number, number, number]
/** A light as the light buffer holds it (`DirectLight`). */
export type LightRecord = ReturnType<typeof recordOf>

/** How far past or short of an edge the points lie: a thousandth of the range, a fiftieth of a
 *  spot's half-angle, a hundredth of a radian off a rectangle's plane — each far above the f32
 *  roundings of a point within 40 m of the origin, far below any light's size. */
const RANGE_MARGIN = 1e-3,
  CONE_MARGIN = 2e-2,
  PLANE_MARGIN = 1e-2

const rand = lcgRandom(1521)
const unit = (v: readonly number[]) => {
  const l = Math.hypot(...v)
  return v.map((x) => x / l) as V3
}
const cross = (a: readonly number[], b: readonly number[]): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const sphere = () => unit([rand() - 0.5, rand() - 0.5, rand() - 0.5])
/** A unit direction `angle` radians off `f`, about a random axis. */
const along = (f: V3, angle: number) => {
  const t = unit(cross(f, sphere()))
  return f.map((x, k) => Math.cos(angle) * x + Math.sin(angle) * t[k]) as V3
}

const base = (kind: SceneLight['kind'], k: number) => ({
  id: `${kind}${k}`,
  kind,
  color: [1, 1, 1] as V3,
  intensity: 1,
})

/** The scene's lights, every kind: lamps within 8 m of the origin, of ranges from 1 to 24 m,
 *  spots of half-angles from 0.15 to 1.2 rad, rectangles of sides from 0.5 to 1.5 m, and suns. */
export const LIGHTS: SceneLight[] = []
for (let k = 0; k < 16; k++) {
  const local = {
    position: sphere().map((x) => x * 8 * rand()) as V3,
    range: 1 + 23 * rand(),
    direction: sphere(),
  }
  LIGHTS.push({ ...base('point', k), ...local, castsShadow: true })
  LIGHTS.push({ ...base('spot', k), ...local, coneAngle: 0.15 + 1.05 * rand(), castsShadow: true })
  LIGHTS.push({
    ...base('rect', k),
    ...local,
    right: unit(cross(local.direction, sphere())),
    size: [0.5 + rand(), 0.5 + rand()],
    castsShadow: false,
  })
  if (k < 8) LIGHTS.push({ ...base('directional', k), direction: sphere(), castsShadow: true })
}

/** A light's record as the light buffer holds it: its five `vec4f` in field order. */
export function recordOf(light: SceneLight) {
  const f = new Float32Array(SCENE_LIGHT_FLOATS)
  writeLightFields(f, 0, light)
  const row = (at: number) => [...f.subarray(at, at + 4)]
  return {
    positionRange: row(0),
    colorIntensity: row(4),
    directionCone: row(8),
    params: row(12),
    shape: row(16),
  }
}

export interface Case {
  P: V3
  inside: boolean
  edge: 'range' | 'cone' | 'plane' | 'sun'
}

/** Points just inside and just outside each edge of the light, from its record's own f32 values:
 *  past or short of its range in a direction it reaches, off a spot's cone at half its range,
 *  before or behind a rectangle's plane. */
export function casesOf(light: SceneLight, r: LightRecord): Case[] {
  const C = r.positionRange.slice(0, 3),
    range = r.positionRange[3],
    f = unit(r.directionCone.slice(0, 3))
  const at = (u: V3, d: number) => C.map((c, k) => Math.fround(c + u[k] * d)) as V3
  const out: Case[] = []
  for (let i = 0; i < 6; i++) {
    if (light.kind === 'directional') {
      out.push({ P: at(sphere(), 30 * rand()), inside: true, edge: 'sun' })
      continue
    }
    // A direction the light reaches: any for a point, within the cone, in front of the rectangle.
    const cone = Math.acos(r.directionCone[3])
    const u =
      light.kind === 'spot'
        ? along(f, 0.5 * cone * rand())
        : light.kind === 'rect'
          ? along(f, 1.2 * rand())
          : sphere()
    for (const inside of [true, false]) {
      const range1 = range * (inside ? 1 - RANGE_MARGIN : 1 + RANGE_MARGIN)
      out.push({ P: at(u, range1), inside, edge: 'range' })
      const d = range * (0.2 + 0.6 * rand())
      if (light.kind === 'spot') {
        const angle = cone * (inside ? 1 - CONE_MARGIN : 1 + CONE_MARGIN)
        out.push({ P: at(along(f, angle), d), inside, edge: 'cone' })
      }
      if (light.kind === 'rect') {
        const angle = Math.PI / 2 + (inside ? -PLANE_MARGIN : PLANE_MARGIN)
        out.push({ P: at(along(f, angle), d), inside, edge: 'plane' })
      }
    }
  }
  return out
}
