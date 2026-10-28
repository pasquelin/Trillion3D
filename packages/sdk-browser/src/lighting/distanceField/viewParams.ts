import { hypot3 } from '../../../../math/src/float/hypot.ts'
import { clipPlanesFromMatrix } from '../../../../math/src/geometry/frustum/frustum.ts'
import { dotVector3 } from '../../../../math/src/vector/vector.ts'
import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'
import { putVec4 } from '../../gpu/core/fieldLayout.ts'

/**
 * THE VIEW'S PARAMETERS THE DISTANCE-FIELD PASSES WRITE ALIKE (the occlusion's `ao/params.ts`, the sun's shadow `shadow/params.ts`, the
 * meshes' trace `rays/meshTrace/gridParams.ts`): matrices scaled to the fields' centimetres, the frustum's planes, the eye's frame.
 */
const CM = CENTIMETRES_PER_METRE

/** Writes the 16 numbers of `m`, its rows `rows` scaled by `by` (rows of the output: the position it yields). */
export function putScaledRows(out: Float32Array, at: number, m: ArrayLike<number>, by: number) {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) out[at + c * 4 + r] = m[c * 4 + r] * (r < 3 ? by : 1)
}

/** The same, its columns `0..2` scaled (the position it takes). */
export function putScaledColumns(out: Float32Array, at: number, m: ArrayLike<number>, by: number) {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) out[at + c * 4 + r] = m[c * 4 + r] * (c < 3 ? by : 1)
}

/** The frustum's raw planes (`clipPlanesFromMatrix`: x ≤ w, −w ≤ x, −w ≤ y, y ≤ w, z ≥ 0, z ≤ w) and the clip
 *  matrix they are taken from, kept between the frames. */
const rawPlanes = new Float64Array(24)
/** The raw planes' slots in the order the passes read them: −w ≤ x, x ≤ w, −w ≤ y, y ≤ w, z ≥ 0, z ≤ w. */
const PLANE_SLOTS = [1, 0, 2, 3, 4, 5]

/**
 * The six planes of the frustum of a view-projection of positions in centimetres, each as `(n, w)` with `dot(n, p) -
 * w` positive outside and `n` of unit length; a plane with no direction (the far plane of an infinite projection)
 * is left out. The count follows.
 */
export function putPlanes(out: Float32Array, at: number, clip: ArrayLike<number>) {
  clipPlanesFromMatrix(rawPlanes, clip)
  let count = 0
  for (const slot of PLANE_SLOTS) {
    const a = rawPlanes[4 * slot],
      b = rawPlanes[4 * slot + 1],
      c = rawPlanes[4 * slot + 2],
      d = rawPlanes[4 * slot + 3]
    const length = hypot3(a, b, c)
    if (length < 1e-12) continue
    putVec4(out, at + count * 4, -a / length, -b / length, -c / length, d / length)
    count++
  }
  return count
}

/** The eye's frame, x right, y up, z forward, in centimetres: the axes of the camera's world matrix `m` (metres), and the eye. */
export function eyeFrame(m: ArrayLike<number>) {
  const axes = [
    [m[0], m[1], m[2]],
    [m[4], m[5], m[6]],
    [-m[8], -m[9], -m[10]],
  ]
  return { axes, eye: [m[12] * CM, m[13] * CM, m[14] * CM] }
}

/** Writes the world-to-view matrix of the camera's world matrix `world` at `at` of `out`. */
export function putWorldToView(out: Float32Array, at: number, world: ArrayLike<number>) {
  writeWorldToView(out, at, eyeFrame(world))
}

export function writeWorldToView(
  out: Float32Array,
  at: number,
  { axes, eye }: ReturnType<typeof eyeFrame>,
) {
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[at + c * 4 + r] = axes[r][c]
    out[at + 12 + r] = -dotVector3(axes[r], eye)
  }
  out[at + 15] = 1
}

/** Writes the three axes of the eye's frame, right, up and forward, as rows of four numbers (the fourth zero): those of the camera's world matrix `world` (column-major, looking down its `-z`). */
export function putEyeAxes(out: Float32Array, at: number, world: ArrayLike<number>) {
  putVec4(out, at, world[0], world[1], world[2])
  putVec4(out, at + 4, world[4], world[5], world[6])
  // `0 - x`, not `-x`: a zero component stays +0.
  putVec4(out, at + 8, 0 - world[8], 0 - world[9], 0 - world[10])
}
