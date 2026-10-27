// The fixtures of the scene trace's culling tests (`sceneCullWgsl.test.ts`): the placement and the culling asked, the twin written from the reference's tests and the shipped
// program run in JavaScript.

import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../../materials/texture/shaderRunMatrix.fixture.ts'
import { f32Bits } from '../../../../../math/src/float/bits.ts'
import {
  DRAW_DISTANCE_MARK,
  DRAW_FAR_WORD,
  DRAW_INSTANCE_MARK,
  DRAW_NEAR_WORD,
  MARK_WORD,
  ROOT_WORD,
} from '../../../geometry/dag/frameTable.ts'
import {
  carriedBounds,
  placement,
  poseOf,
  referenceSphereRadius,
} from '../../../geometry/dag/shader/drawDistance.fixture.ts'
import { DEG2RAD } from '../../../../../math/src/constants.ts'
import { SCENE_CULL_FLAGS, SCENE_CULL_MODE, SCENE_CULL_WGSL } from './sceneCullWgsl.ts'

/** What a culling is asked: the mode, the radius in metres, the angle in degrees, the switches, the view's direction, the
 *  scale of the instances' draw distances and whether they are tested. */
export interface Culling {
  mode: number
  radius: number
  angle: number
  box: boolean
  minDraw: boolean
  direction: number[]
  scale: number
  instances: boolean
}
export const DEFAULTS: Culling = {
  mode: 3,
  radius: 300,
  angle: 1,
  box: true,
  minDraw: true,
  direction: [0, 0, -1],
  scale: 1,
  instances: true,
}

/** The eye is the origin; `m` carries the box `low`–`high` of a placement's space to the world, `near` and `far` its draw
 *  distances (0 for none), those of an instance of an instanced mesh where `instance`. */
export interface Placed {
  m: number[]
  low: number[]
  high: number[]
  near?: number
  far?: number
  instance?: boolean
}

/**
 * The twin: the reference's tests written from their formulas. A primitive is culled by its bounds — the box carried to the
 * world and its sphere, the half diagonal at the greatest axis scale held to the carried box's — in the mode's way: a mode
 * 1 considers only what lies behind the camera or nearer than its least draw distance; an object nearer than that
 * distance is culled; a mode 3 culls the far and the small, the others the far and small. An instance is culled by the modes
 * 2 and 3 alone, by the sphere of its box at the scale along each axis, then, an instance of an instanced mesh, when the
 * square of its centre's distance is not between the squares of its scaled draw distances.
 */
export function twin(p: Placed, c: Culling) {
  if (c.mode === 0) return false
  const carried = carriedBounds(p.m, p.low, p.high)
  const centre = [0, 1, 2].map((a) => 0.5 * (carried.low[a] + carried.high[a]))
  const extent = [0, 1, 2].map((a) => 0.5 * (carried.high[a] - carried.low[a]))
  const half = [0, 1, 2].map((a) => 0.5 * (p.high[a] - p.low[a]))
  const distanceToBox = Math.hypot(
    ...[0, 1, 2].map((a) => Math.max(Math.abs(centre[a]) - extent[a], 0)),
  )
  const ratioSq = Math.tan(Math.min(89.99, c.angle) * DEG2RAD) ** 2
  const least = p.near && !p.instance ? p.near : 0
  const distance = (radius: number, length: number) =>
    c.box ? distanceToBox : Math.max(length - radius, 0)
  // As a primitive.
  {
    const radius = referenceSphereRadius(p.m, p.low, p.high)
    const length = Math.hypot(...centre)
    const behind = c.direction.reduce((sum, d, a) => sum + d * centre[a], 0) < -radius
    const near = c.minDraw && length < least
    const considered = c.mode >= SCENE_CULL_MODE.distanceAndSolidAngle || behind || near
    if (considered) {
      const far = distance(radius, length) > c.radius
      const small = (radius * radius) / (length * length) < ratioSq
      const either = c.mode === SCENE_CULL_MODE.distanceOrSolidAngle
      if (near) return true
      if (either ? far || small : far && small) return true
    }
  }
  // As an instance.
  if (c.mode >= SCENE_CULL_MODE.distanceAndSolidAngle) {
    const scale = [0, 1, 2].map((a) => Math.hypot(p.m[4 * a], p.m[4 * a + 1], p.m[4 * a + 2]))
    const radius = Math.hypot(...[0, 1, 2].map((a) => half[a] * scale[a]))
    const length = Math.hypot(...centre)
    const visibleDistance = distance(radius, length) <= c.radius
    const visibleAngle = (radius * radius) / (length * length) >= ratioSq
    const visible =
      c.mode === SCENE_CULL_MODE.distanceOrSolidAngle
        ? visibleDistance && visibleAngle
        : visibleDistance || visibleAngle
    if (!visible) return true
    if (c.instances && p.instance && p.near !== undefined) {
      const min = p.near * c.scale
      const max = p.far ? p.far * c.scale : Infinity
      if (!(length * length >= min * min && length * length <= max * max)) return true
    }
  }
  return false
}

/** The program run in JavaScript for the placement `p` as placement 0 of the cut, under the culling `c`. */
export function shipped(p: Placed, c: Culling) {
  const mark = p.near === undefined ? 0 : DRAW_DISTANCE_MARK | (p.instance ? DRAW_INSTANCE_MARK : 0)
  const params = {
    eyeXY: [0, 0, 0, 0],
    eyeZ: [0, 0],
    cullRadius: c.radius,
    culledTanAngleSq: Math.tan(Math.min(89.99, c.angle) * DEG2RAD) ** 2,
    placements: 1,
    cullWord: 0,
    cullMode: c.mode,
    cullFlags:
      (c.box ? SCENE_CULL_FLAGS.distanceToBox : 0) |
      (c.minDraw ? SCENE_CULL_FLAGS.minDrawDistance : 0) |
      (c.instances ? SCENE_CULL_FLAGS.instanceDrawDistance : 0),
    viewDirection: c.direction,
    viewDistanceScale: c.scale,
  }
  const kernel = shaderRun<{ scCulled(w: number): boolean }>(SCENE_CULL_WGSL, ['scCulled'], {
    stParams: params,
    framesWord: (_w: number, k: number) =>
      k === ROOT_WORD
        ? 0
        : k === MARK_WORD
          ? mark
          : k === DRAW_NEAR_WORD
            ? f32Bits(p.near ?? 0)
            : k === DRAW_FAR_WORD
              ? f32Bits(p.far ?? 0)
              : 0,
    worldsWorldAtEye: () => new Mat(p.m),
    nodesLow: () => p.low,
    nodesHigh: () => p.high,
  })
  return kernel.scCulled(0)
}

/** The placement at `distance` metres along `direction`, its box a cube of half side `half`. */
export const cube = (
  distance: number,
  half: number,
  direction = [0, 0, -1],
  extra: Partial<Placed> = {},
): Placed => ({
  m: poseOf(direction.map((d) => d * distance)),
  low: [-half, -half, -half],
  high: [half, half, half],
  ...extra,
})
