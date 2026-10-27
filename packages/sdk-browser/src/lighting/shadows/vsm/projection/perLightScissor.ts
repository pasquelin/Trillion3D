/**
 * THE SCREEN RECTANGLE A LOCAL LIGHT REACHES (`perLightPass.ts`): the pixels inside the projection of
 * the sphere of its range, which the per-light path clears, projects, composites and draws, a light
 * past it lighting none. On each axis the two planes through the eye that touch the sphere bound its
 * image: the sphere's image lies between the two lines where the planes cut the screen. A plane whose
 * touching point is behind the eye bounds nothing on its side; no plane, the eye being within the
 * sphere's shadow on that axis, bounds nothing on the axis; an eye inside the sphere sees it over the
 * whole view. An orthographic view bounds it by the sphere's extent on the axis.
 */

/** Pixels the rectangle is widened by on every side: one a plane grazes, which the rounding to whole
 *  pixels would leave out. */
const PAD = 1

/** The bounds an axis of the screen leaves of the sphere, in clip units, − 1 to 1: the pair
 *  starts at the view's edges and narrows to the sphere's (`bounds[0]` the lower, `bounds[1]` the upper). */
const bounds = new Float64Array(2)

/**
 * Narrows `bounds` to the image of a sphere whose centre is `along` across the axis (view space) and
 * `depth` in front of the eye, of radius `radius`, on a perspective axis of the projection with
 * `scale` (its diagonal) and `skew` (the term that multiplies the depth).
 */
function perspectiveAxis(
  along: number,
  depth: number,
  radius: number,
  scale: number,
  skew: number,
) {
  const distance = Math.hypot(along, depth)
  if (distance <= radius) return
  const centre = Math.atan2(along, depth)
  const half = Math.asin(radius / distance)
  const low = centre - half
  const high = centre + half
  // A tangent line that points behind the eye touches the sphere behind it: it bounds nothing.
  if (Math.cos(low) > 0) bounds[0] = Math.max(bounds[0], scale * Math.tan(low) - skew)
  if (Math.cos(high) > 0) bounds[1] = Math.min(bounds[1], scale * Math.tan(high) - skew)
}

/** Narrows `bounds` to the extent of the sphere on an orthographic axis. */
function orthographicAxis(
  along: number,
  depth: number,
  radius: number,
  scale: number,
  skew: number,
  offset: number,
) {
  const at = -skew * depth + offset
  bounds[0] = Math.max(bounds[0], scale * (along - radius) + at)
  bounds[1] = Math.min(bounds[1], scale * (along + radius) + at)
}

/**
 * Writes into `out` at `at` the pixel rectangle (x0, y0, x1 one past the last column, y1 one past the
 * last row) of the sphere at `position`, of `radius`, seen by the camera whose world → view and
 * view → clip matrices are `view` and `projection` (column-major, the engine's: the view looks down −Z)
 * over a `width` × `height` target. False, and `out` unwritten, where the sphere is past the screen.
 */
export function projectedLightRect(
  out: Int32Array,
  at: number,
  position: ArrayLike<number>,
  radius: number,
  view: ArrayLike<number>,
  projection: ArrayLike<number>,
  perspective: boolean,
  width: number,
  height: number,
) {
  const px = position[0],
    py = position[1],
    pz = position[2]
  const x = view[0] * px + view[4] * py + view[8] * pz + view[12]
  const y = view[1] * px + view[5] * py + view[9] * pz + view[13]
  const depth = -(view[2] * px + view[6] * py + view[10] * pz + view[14])
  let x0 = 0,
    x1 = width,
    y0 = 0,
    y1 = height
  // An eye inside the sphere sees it over the whole view.
  if (x * x + y * y + depth * depth > radius * radius) {
    // The sphere wholly behind the eye's plane lights nothing in front of it.
    if (perspective && depth + radius <= 0) return false
    bounds[0] = -1
    bounds[1] = 1
    if (perspective) perspectiveAxis(x, depth, radius, projection[0], projection[8])
    else orthographicAxis(x, depth, radius, projection[0], projection[8], projection[12])
    if (bounds[0] >= bounds[1]) return false
    x0 = Math.floor((bounds[0] * 0.5 + 0.5) * width) - PAD
    x1 = Math.ceil((bounds[1] * 0.5 + 0.5) * width) + PAD
    bounds[0] = -1
    bounds[1] = 1
    if (perspective) perspectiveAxis(y, depth, radius, projection[5], projection[9])
    else orthographicAxis(y, depth, radius, projection[5], projection[9], projection[13])
    if (bounds[0] >= bounds[1]) return false
    // The screen's rows run down, clip space's up.
    y0 = Math.floor((0.5 - bounds[1] * 0.5) * height) - PAD
    y1 = Math.ceil((0.5 - bounds[0] * 0.5) * height) + PAD
  }
  x0 = Math.max(x0, 0)
  y0 = Math.max(y0, 0)
  x1 = Math.min(x1, width)
  y1 = Math.min(y1, height)
  if (x0 >= x1 || y0 >= y1) return false
  out[at] = x0
  out[at + 1] = y0
  out[at + 2] = x1
  out[at + 3] = y1
  return true
}
