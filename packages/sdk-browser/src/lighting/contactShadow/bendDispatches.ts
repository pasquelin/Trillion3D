/**
 * THE DISPATCHES OF A SCREEN-SPACE SHADOW MARCHED FROM A LIGHT'S PLACE ON THE SCREEN (`bendWgsl.ts`): the kernel marches a
 * wavefront of `BEND_WAVE` pixels along the line from each pixel toward the light, so its groups are laid in the four quadrants about
 * the light's pixel, each quadrant a rectangle of wavefronts with a corner on the light, cut in two on its longer side where it is not
 * square. At most eight dispatches (two for each quadrant), a few when the light is off the screen and up to six when it is on it.
 */

/** The pixels of a wavefront, the workgroup size of the kernel. */
export const BEND_WAVE = 64
/** The most dispatches of one light. */
export const BEND_MAX_DISPATCHES = 8
/** The most lights marched in an image, a layer each (`bendTarget.ts`, `contactShadowBendMaxLights`); the others cast their stochastic ray. */
export const BEND_MAX_LAYERS = 16

/** One dispatch: the groups along x (always the wave), y and z, and the wavefront offset the kernel starts at, in pixels. */
interface BendDispatch {
  groups: [number, number, number]
  offset: [number, number]
}

/** The dispatches of a light and the light's coordinate, the same for them all: its pixel in `x` and `y`, its depth in `z`, and in `w` 1
 *  when the light is in front of the eye (a point or spot) and −1 when behind (the sun is a direction, in front when it shines toward the eye). */
export interface BendDispatchList {
  light: [number, number, number, number]
  dispatches: BendDispatch[]
}

/** A quadrant's dispatch cut in two where the diagonal ray leaves it (`delta` groups from its corner), the cut half one group wider. */
function splitAtDiagonal(q: number, main: BendDispatch, delta: number): BendDispatch[] {
  const parts: BendDispatch[] = [main]
  if (delta <= 0) return parts
  const split: BendDispatch = { groups: [...main.groups], offset: [...main.offset] }
  if (q === 0) {
    split.groups[2] = Math.min(main.groups[2], delta)
    main.groups[2] -= split.groups[2]
    split.offset[1] = main.offset[1] + main.groups[2]
    split.offset[0]--
    split.groups[1]++
  } else if (q === 1) {
    split.groups[1] = Math.min(main.groups[1], delta)
    main.groups[1] -= split.groups[1]
    split.offset[0] = main.offset[0] + main.groups[1]
    split.groups[2]++
  } else if (q === 2) {
    split.groups[1] = Math.min(main.groups[1], delta)
    main.groups[1] -= split.groups[1]
    main.offset[0] += split.groups[1]
    split.groups[2]++
    split.offset[1]--
  } else {
    split.groups[2] = Math.min(main.groups[2], delta)
    main.groups[2] -= split.groups[2]
    main.offset[1] += split.groups[2]
    split.groups[1]++
  }
  parts.push(split)
  return parts
}

/** Groups from the corner of quadrant `q` to where the diagonal ray leaves the rectangle `b` (left, bottom, right, top about the light). */
function diagonalGroups(q: number, b: readonly number[], wave: number) {
  let delta = b[0] - b[1]
  if (q === 1) delta = b[2] + b[1]
  if (q === 2) delta = -b[0] - b[3]
  if (q === 3) delta = -b[2] + b[3]
  return Math.trunc((delta + wave - 1) / wave)
}

/** The dispatches of quadrant `q` of the rectangle `b` about the light, in waves: none where it holds no wavefront. */
function quadrantDispatches(q: number, b: readonly number[], wave: number): BendDispatch[] {
  // Quadrants 0 and 3 are one wave taller, 1 and 2 one wave wider, for the diagonal's reads.
  const vertical = q === 0 || q === 3
  const lo = [
    Math.trunc(Math.max(0, q & 1 ? b[0] : -b[2]) / wave),
    Math.trunc(Math.max(0, q & 2 ? b[1] : -b[3]) / wave),
  ]
  const hi = [
    Math.trunc(Math.max(0, (q & 1 ? b[2] : -b[0]) + wave * (vertical ? 1 : 2) - 1) / wave),
    Math.trunc(Math.max(0, (q & 2 ? b[3] : -b[1]) + wave * (vertical ? 2 : 1) - 1) / wave),
  ]
  if (hi[0] - lo[0] <= 0 || hi[1] - lo[1] <= 0) return []
  const main: BendDispatch = {
    groups: [wave, hi[0] - lo[0], hi[1] - lo[1]],
    offset: [
      (q & 1 ? lo[0] : -hi[0]) + (q === 2 || q === 3 ? 1 : 0),
      (q & 2 ? -hi[1] : lo[1]) + (q === 1 || q === 3 ? 1 : 0),
    ],
  }
  // The far corner of the quadrant relative to the light: where the diagonal ray leaves the rectangle.
  return splitAtDiagonal(q, main, diagonalGroups(q, b, wave)).filter(
    (part) => part.groups[1] > 0 && part.groups[2] > 0,
  )
}

/**
 * The dispatches that cover the pixels `min`..`max` (inclusive, the light's rectangle of the screen) of a `size` view for the light whose
 * clip position, taken without the divide by w, is `projection` — `(position, 1)` for a point light, `(direction toward it, 0)` for a
 * sun —, wavefronts of `wave` pixels.
 */
export function bendDispatchList(
  projection: readonly [number, number, number, number],
  size: readonly [number, number],
  min: readonly [number, number],
  max: readonly [number, number],
  wave = BEND_WAVE,
): BendDispatchList {
  // The divide by w loses its precision for a light very far off the screen: w is held off 0 by a margin that scales with the wave.
  const limit = 0.000002 * wave
  let w = projection[3]
  if (w >= 0 && w < limit) w = limit
  else if (w < 0 && w > -limit) w = -limit
  // The kernel is given the light in single floats and finds its pixel from them: so is the rectangle's.
  const light: [number, number, number, number] = [
    Math.fround((projection[0] / w) * 0.5 * size[0] + 0.5 * size[0]),
    Math.fround((projection[1] / w) * -0.5 * size[1] + 0.5 * size[1]),
    Math.fround(projection[3] === 0 ? 0 : projection[2] / projection[3]),
    projection[3] > 0 ? 1 : -1,
  ]
  const at = [Math.trunc(light[0] + 0.5), Math.trunc(light[1] + 0.5)]
  // The rectangle relative to the light, y up: left, bottom, right, top.
  const b = [min[0] - at[0], -(max[1] - at[1]), max[0] - at[0], -(min[1] - at[1])]
  const list: BendDispatch[] = []
  for (let q = 0; q < 4; q++) list.push(...quadrantDispatches(q, b, wave))
  for (const d of list) {
    d.offset[0] *= wave
    d.offset[1] *= wave
  }
  return { light, dispatches: list }
}
