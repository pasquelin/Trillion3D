/**
 * THE SYMBOLS THE LIGHT COMPLEXITY VIEW DRAWS in the world, as lines: a wire sphere for a point light, a spot's arc, a rectangle light's two nested rectangles, and the box round a voxel. The
 * symbols that face the camera take its right and up axes (unit vectors, `cameraAxes`).
 */
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { DebugLines } from '../../../../hair/debugLines.ts'

type Vec3 = readonly [number, number, number]

const add = (a: Vec3, b: Vec3, scale = 1): Vec3 => [
  a[0] + b[0] * scale,
  a[1] + b[1] * scale,
  a[2] + b[2] * scale,
]

/** The unit right and up axes of the camera's view, from its world matrix. */
export function cameraAxes(cam: Pick<EngineCamera, 'world'>): { right: Vec3; up: Vec3 } {
  const unit = (x: number, y: number, z: number): Vec3 => {
    const length = Math.hypot(x, y, z) || 1
    return [x / length, y / length, z / length]
  }
  const w = cam.world
  return { right: unit(w[0]!, w[1]!, w[2]!), up: unit(w[4]!, w[5]!, w[6]!) }
}

/** Segments of the circles of a sphere. */
const SPHERE_SEGMENTS = 16
/** Segments of a spot's arc, and the angle it covers. */
const SPOT_SEGMENTS = 8
const SPOT_ANGLE = (2 / 3) * Math.PI

/** The wire sphere of `radius` at `centre`: its three great circles. */
export function sphereSymbol(lines: DebugLines, centre: Vec3, radius: number, color: number) {
  for (const [a, b] of [
    [0, 1],
    [1, 2],
    [2, 0],
  ] as const) {
    let previous: Vec3 | undefined
    for (let step = 0; step <= SPHERE_SEGMENTS; step++) {
      const angle = (step / SPHERE_SEGMENTS) * 2 * Math.PI
      const offset: [number, number, number] = [0, 0, 0]
      offset[a] = Math.cos(angle) * radius
      offset[b] = Math.sin(angle) * radius
      const point = add(centre, offset)
      if (previous) lines.world(previous, point, color)
      previous = point
    }
  }
}

/** A spot's symbol at `centre`: the arc of two thirds of a turn round the top, closed to the top by its two ends. */
export function spotSymbol(
  lines: DebugLines,
  centre: Vec3,
  radius: number,
  axes: { right: Vec3; up: Vec3 },
  color: number,
) {
  const top = add(centre, axes.up, radius)
  const on = (angle: number) =>
    add(add(centre, axes.right, Math.cos(angle) * radius), axes.up, Math.sin(angle) * radius)
  let angle = Math.PI + (Math.PI - SPOT_ANGLE) * 0.5
  let point = on(angle)
  lines.world(point, top, color)
  for (let step = 0; step < SPOT_SEGMENTS; step++) {
    angle += SPOT_ANGLE / SPOT_SEGMENTS
    const next = on(angle)
    lines.world(point, next, color)
    point = next
  }
  lines.world(point, top, color)
}

/** The four corners of the rectangle of half sizes `extent` (across, up) facing the camera at `centre`. */
function rectCorners(centre: Vec3, extent: number, axes: { right: Vec3; up: Vec3 }): Vec3[] {
  const corner = (x: number, y: number) =>
    add(add(centre, axes.right, x * extent), axes.up, y * extent)
  return [corner(1, 1), corner(1, -1), corner(-1, -1), corner(-1, 1)]
}

/** A rectangle light's symbol at `centre`: the rectangle of half size `extent`, one of 0.6 of it inside, and the four lines between their corners. */
export function rectSymbol(
  lines: DebugLines,
  centre: Vec3,
  extent: number,
  axes: { right: Vec3; up: Vec3 },
  color: number,
) {
  const outer = rectCorners(centre, extent, axes)
  const inner = rectCorners(centre, extent * 0.6, axes)
  for (const ring of [outer, inner])
    ring.forEach((corner, at) => lines.world(corner, ring[(at + 1) % 4]!, color))
  outer.forEach((corner, at) => lines.world(corner, inner[at]!, color))
}
