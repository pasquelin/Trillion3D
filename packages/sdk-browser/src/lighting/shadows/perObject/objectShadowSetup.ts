import { clamp, clampLowWins } from '../../../../../math/src/scalar/reals.ts'
import { multiplyMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import {
  dotVector3,
  length3,
  normalizeVector3OrZero,
  scaleVector3,
} from '../../../../../math/src/vector/vector.ts'
import { cross, subtract, type Vec3 } from '../../../../../math/src/vector/vectorTuple.ts'
import { OBJECT_SHADOW_BORDER, type ObjectShadowSettings } from './translucentShadowRules.ts'

/**
 * THE PROJECTION OF AN OBJECT'S SHADOW: for a light x object pair, the frame that looks at the object from the light and
 * the rectangle that frame fills, as the translucent shadow passes draw and read them. Lengths are in the unit of the
 * shadow settings (centimetres). Matrices are 4x4, row-major, for row vectors (a point is multiplied on the left), the way
 * the shadow projections are written.
 */

const DELTA = 0.00001
const HALF_WORLD_MAX = 4398046511104
const WORLD_MAX = 8796093022208
const OLD_HALF_WORLD_MAX = 1048576

/** A bounding box and sphere: centre, half extents, sphere radius. */
export interface Bounds {
  readonly origin: Vec3
  readonly extent: Vec3
  readonly radius: number
}

/** A light as the projection needs it: a directional light by the direction it shines in, a local light by its position and radius. */
export type ObjectShadowLight =
  | { readonly kind: 'directional'; readonly direction: Vec3 }
  | { readonly kind: 'local'; readonly position: Vec3; readonly radius: number }

/** Where a light looks at an object from. */
export interface ObjectShadowInitializer {
  /** Added to a world position before the frame is applied. */
  readonly preShadowTranslation: Vec3
  /** The rows of the frame whose x axis points from the light at the object (a point's light coordinates are its dots with them). */
  readonly axes: readonly [Vec3, Vec3, Vec3]
  /** The object's bounds in the translated space. */
  readonly subject: Bounds
  /** The weights of the depth and of 1 in the projection's w: (0, 0, 0, 1) for a directional light, (0, 0, 1, 0) for a local one. */
  readonly wAxis: readonly [number, number, number, number]
  readonly minLightW: number
  readonly maxDistanceToCastInLightW: number
}

/** The projection of one object shadow. */
export interface ObjectShadowProjection {
  readonly resolutionX: number
  readonly resolutionY: number
  readonly border: number
  readonly translatedWorldToView: Float64Array
  readonly translatedWorldToClipInner: Float64Array
  readonly translatedWorldToClipOuter: Float64Array
  readonly preShadowTranslation: Vec3
  readonly minSubjectZ: number
  readonly maxSubjectZ: number
  /** Where a directional light's shadow starts to fade along the subject's depth range and the inverse of the length of that fade (0 and 0 for a local light, or where the receiver range ends in the subject's). */
  readonly fadeStart: number
  readonly invFadeLength: number
  /** The reciprocal of the depth the shadow's depths are divided by: 1 over 1 for a directional light, over the nearest subject depth for a local one. */
  readonly invMaxSubjectDepth: number
  readonly maxScreenPercent: number
  readonly translucent: boolean
  /** The light is a directional one: the depth pass clamps the vertices in front of the subject's near end to it. */
  readonly directional: boolean
}

/** A unit vector of `v` in a fresh tuple, zero where `v` is shorter than 1e-8. */
const safeNormal = (v: Vec3): Vec3 => normalizeVector3OrZero<Vec3>([0, 0, 0], v, 1e-16)

/** The frame whose first row is `forward`: the others are any perpendicular pair (the shadow keeps no roll of its own). */
function frameFrom(forward: Vec3): [Vec3, Vec3, Vec3] {
  const up: Vec3 = Math.abs(forward[2]) < 0.999 ? [0, 0, 1] : [1, 0, 0]
  const right = safeNormal(cross(up, forward))
  return [forward, right, cross(forward, right)]
}

/**
 * Where a light looks at an object from, or `null` where it cannot. A directional light looks along its direction from the object's centre, its projection scaled to the sphere; a local light looks
 * from its position, drawing back to fit an object it is inside of, with a field that just holds the object's sphere.
 */
export function objectShadowInitializer(
  light: ObjectShadowLight,
  bounds: Bounds,
  s: ObjectShadowSettings,
): ObjectShadowInitializer | null {
  if (light.kind === 'directional') {
    const forward = safeNormal(light.direction)
    if (forward[0] === 0 && forward[1] === 0 && forward[2] === 0) return null
    return {
      preShadowTranslation: [-bounds.origin[0], -bounds.origin[1], -bounds.origin[2]],
      axes: frameFrom(forward),
      subject: { origin: [0, 0, 0], extent: bounds.extent, radius: bounds.radius },
      wAxis: [0, 0, 0, 1],
      minLightW: -OLD_HALF_WORLD_MAX,
      maxDistanceToCastInLightW: clamp(
        bounds.radius * s.castDistanceRadiusScale,
        s.castDistanceMin,
        WORLD_MAX,
      ),
    }
  }
  const subjectRadius = length3(...bounds.extent)
  const radiusMultiplier = 1.1
  let position = light.position
  let vector: Vec3 = subtract(bounds.origin, position)
  const distance = length3(...vector)
  if (distance <= subjectRadius * radiusMultiplier) {
    // Draw the light back along its line to the object until the object fits a field under 90 degrees.
    vector = scaleVector3(safeNormal(vector), subjectRadius * radiusMultiplier)
    position = subtract(bounds.origin, vector)
  }
  const forward = safeNormal(vector)
  if (forward[0] === 0 && forward[1] === 0 && forward[2] === 0) return null
  return {
    preShadowTranslation: [-position[0], -position[1], -position[2]],
    axes: frameFrom(forward),
    subject: {
      origin: [
        bounds.origin[0] - position[0],
        bounds.origin[1] - position[1],
        bounds.origin[2] - position[2],
      ],
      extent: bounds.extent,
      radius: bounds.radius,
    },
    wAxis: [0, 0, 1, 0],
    minLightW: 0.1,
    maxDistanceToCastInLightW: light.radius,
  }
}

/** The eight corners of a box, and its twelve edges as index pairs. */
function boxCorners(origin: Vec3, extent: Vec3) {
  const points: Vec3[] = []
  for (let x = 0; x < 2; x++)
    for (let y = 0; y < 2; y++)
      for (let z = 0; z < 2; z++)
        points.push([
          origin[0] + (x ? -extent[0] : extent[0]),
          origin[1] + (y ? -extent[1] : extent[1]),
          origin[2] + (z ? -extent[2] : extent[2]),
        ])
  const edges: [number, number][] = []
  for (let x = 0; x < 2; x++) {
    const b = x * 4
    edges.push([b, b + 1], [b + 1, b + 3], [b + 3, b + 2], [b + 2, b])
  }
  for (let e = 0; e < 4; e++) edges.push([e, e + 4])
  return { points, edges }
}

/**
 * The frame, around the light's x axis, that holds the points in the smallest rectangle: each edge of the box gives a trial x axis
 * (the edge with its part along the light's axis taken out), the rectangle of the points on it is measured, and the smallest of non-zero area wins, its x
 * axis the long one. `null` if no trial has an area.
 */
function bestShadowTransform(
  points: readonly Vec3[],
  edges: readonly (readonly [number, number])[],
) {
  const z: Vec3 = [1, 0, 0]
  let bestArea = Infinity
  let best: { xAxis: Vec3; min: [number, number]; max: [number, number] } | null = null
  for (const [a, b] of edges) {
    const delta: Vec3 = [
      points[b]![0] - points[a]![0],
      points[b]![1] - points[a]![1],
      points[b]![2] - points[a]![2],
    ]
    const along = dotVector3(delta, z)
    const trialX = safeNormal([
      delta[0] - z[0] * along,
      delta[1] - z[1] * along,
      delta[2] - z[2] * along,
    ])
    const trialY = safeNormal(cross(z, trialX))
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of points) {
      const px = dotVector3(p, trialX)
      const py = dotVector3(p, trialY)
      minX = Math.min(minX, px)
      maxX = Math.max(maxX, px)
      minY = Math.min(minY, py)
      maxY = Math.max(maxY, py)
    }
    const area = (maxX - minX) * (maxY - minY)
    if (area < bestArea - 0.05 && area > DELTA) {
      bestArea = area
      best =
        maxY - minY > maxX - minX
          ? { xAxis: trialY, min: [minY, -maxX], max: [maxY, -minX] }
          : { xAxis: trialX, min: [minX, minY], max: [maxX, maxY] }
    }
  }
  return best && bestArea > DELTA ? best : null
}

/** The row-major product `a` then `b` for row vectors, which is the column-major product `b` times `a`. */
const multiply = (a: Float64Array, b: Float64Array) => multiplyMatrix4(new Float64Array(16), b, a)

/** The projection with its depth range set to `minZ`..`maxZ` (reversed depth). */
function withDepthRange(m: Float64Array, minZ: number, maxZ: number) {
  const out = Float64Array.from(m)
  out[10] = -(m[11]! * minZ + m[15]!) / (maxZ - minZ)
  out[14] = -maxZ * out[10]!
  return out
}

/**
 * The projection of the shadow an initializer's light casts of its object into a rectangle of `resolutionX` texels across (at most
 * `maxResolutionY` down, its aspect that of the object's rectangle), with the border round it; `null` where the object reaches behind a local light or has no area to the light.
 */
export function setupObjectProjection(
  init: ObjectShadowInitializer,
  resolutionX: number,
  maxResolutionY: number,
  maxScreenPercent: number,
  translucent: boolean,
  border = OBJECT_SHADOW_BORDER,
): ObjectShadowProjection | null {
  const directional = init.wAxis[3] === 1
  const { points, edges } = boxCorners(init.subject.origin, init.subject.extent)
  const lightPoint = (p: Vec3): Vec3 => [
    dotVector3(p, init.axes[0]),
    dotVector3(p, init.axes[1]),
    dotVector3(p, init.axes[2]),
  ]
  const projected: Vec3[] = []
  for (const p of points) {
    const l = lightPoint(p)
    const w = l[0] * init.wAxis[2] + init.wAxis[3]
    if (!(w >= DELTA)) return null
    projected.push([l[0] / w, l[1] / w, l[2] / w])
  }
  const best = bestShadowTransform(projected, edges)
  if (!best) return null
  const zAxis: Vec3 = [1, 0, 0]
  const yAxis = safeNormal(cross(zAxis, best.xAxis))
  // The light's frame, then the shadow's basis: a point's view coordinates are its light coordinates' dots with the basis.
  const basis: Vec3[] = [best.xAxis, yAxis, zAxis]
  const toView = new Float64Array(16)
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 3; r++) {
      let sum = 0
      for (let k = 0; k < 3; k++) sum += init.axes[k]![r]! * basis[c]![k]!
      toView[r * 4 + c] = sum
    }
  toView[15] = 1
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of points) {
    const z = p[0] * toView[2]! + p[1] * toView[6]! + p[2] * toView[10]!
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  const minSubjectZ = Math.max(init.minLightW, minZ)
  const maxReceiverZ = clampLowWins(
    minSubjectZ + init.maxDistanceToCastInLightW,
    minSubjectZ + 1,
    HALF_WORLD_MAX,
  )
  const maxSubjectZ = Math.max(maxZ, minSubjectZ + 1)
  const ex = best.max[0] - best.min[0]
  const ey = best.max[1] - best.min[1]
  const resolutionY = clamp(Math.trunc(resolutionX / (ex / ey)), 1, maxResolutionY)
  if (resolutionX === 0 || resolutionY === 0) return null
  const bx = resolutionX / (resolutionX + 2 * border)
  const by = resolutionY / (resolutionY + 2 * border)
  const [w0, w1, w2, w3] = init.wAxis
  const inner = Float64Array.of(
    2 / ex,
    0,
    0,
    w0,
    0,
    2 / ey,
    0,
    w1,
    -(best.max[0] + best.min[0]) / ex,
    -(best.max[1] + best.min[1]) / ey,
    0,
    w2,
    0,
    0,
    1,
    w3,
  )
  const outer = Float64Array.from(inner)
  for (let r = 0; r < 4; r++) {
    outer[r * 4]! *= bx
    outer[r * 4 + 1]! *= by
  }
  const clipInner = multiply(toView, withDepthRange(inner, minSubjectZ, maxSubjectZ))
  const clipOuter = multiply(toView, withDepthRange(outer, minSubjectZ, maxSubjectZ))
  let fadeStart = 0
  let invFadeLength = 0
  if (directional && maxSubjectZ < maxReceiverZ) {
    // The shadow fades out over the receiver range's end past the subject, no longer than the subject's own range.
    const range = maxSubjectZ - minSubjectZ
    const length = Math.min(range, maxReceiverZ - maxSubjectZ)
    fadeStart = (maxReceiverZ - minSubjectZ - length) / range
    invFadeLength = range / Math.max(0.000001, length)
  }
  return {
    resolutionX,
    resolutionY,
    border,
    translatedWorldToView: toView,
    translatedWorldToClipInner: clipInner,
    translatedWorldToClipOuter: clipOuter,
    preShadowTranslation: init.preShadowTranslation,
    minSubjectZ,
    maxSubjectZ,
    fadeStart,
    invFadeLength,
    invMaxSubjectDepth: 1 / (directional ? 1 : minSubjectZ),
    directional,
    maxScreenPercent,
    translucent,
  }
}
