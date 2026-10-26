import { putVec4 as put } from '../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import { frameAround } from '../../../../math/src/vector/frame.ts'
import { cameraForward } from '../../camera/forward.ts'
import type { ResolvedAtmosphere } from '../../../../sdk-core/src/scene/core/atmosphere.ts'
import { EYE_FLOOR } from './layout.ts'
import { FRAME_LAYOUT } from './frameLayout.ts'

/** The frame's words. */
export const FRAME_FLOATS = FRAME_LAYOUT.words
/** `camera` holds the eye relative to the planet's centre, kilometres, and its distance from it;
 *  `eye` the eye in the scene, metres, and 1 for a perspective view (0 for an orthographic one,
 *  whose pixels' rays start each at its own point: `airRay`, `airRayWgsl.ts`);
 *  `lift` the raise of those points, scene metres, on the planet's up (the scene's `y`): half the
 *  view's height under an orthographic view (`orthographicLift`), 0 under a perspective one;
 *  `size` the image's pixels and their inverse; `capture` the place the sky is captured from,
 *  scene metres, and its altitude above the planet's ground, kilometres; `preExposure` the number
 *  the sky's light is multiplied by as it is written (x; 1 for a capture); `index` the image's number
 *  (the noise a marched pixel jitters by). */
export const FRAME_WGSL = wgslBlock('FRAME_WGSL', [], FRAME_LAYOUT.wgsl)

/** Half the distance between the points at the top and the bottom edges of the view, metres: the
 *  unprojections of `(0, ±1)` at device depth 1 by the inverse view-projection `inverse`
 *  (column-major), the same at any depth under an orthographic projection. */
function orthographicLift(m: ArrayLike<number>) {
  const top = m[7] + m[11] + m[15],
    bottom = -m[7] + m[11] + m[15]
  return (
    0.5 *
    length3(
      (m[4] + m[8] + m[12]) / top - (-m[4] + m[8] + m[12]) / bottom,
      (m[5] + m[9] + m[13]) / top - (-m[5] + m[9] + m[13]) / bottom,
      (m[6] + m[10] + m[14]) / top - (-m[6] + m[10] + m[14]) / bottom,
    )
  )
}

/** The unit forward of the camera the frame is written for, rewritten each image. */
const look = new Float64Array(3)

/** The two rows of the frame around the up, when the look runs along it. */
const rows = new Float64Array(6)

/**
 * The table's axes into `out`, `forward` and `left` at the places `at` names, for the planet's up
 * `(ux, uy, uz)` at the eye and the camera's unit look `(lx, ly, lz)`: the look made to lie across
 * the up, or, looking straight along the up, any orthonormal pair around it.
 */
function putAxes(
  out: Float32Array,
  at: { forward: number; left: number },
  ux: number,
  uy: number,
  uz: number,
  lx: number,
  ly: number,
  lz: number,
) {
  let fx: number, fy: number, fz: number, sx: number, sy: number, sz: number
  if (Math.abs(lx * ux + ly * uy + lz * uz) > 0.999) {
    // Looking along the up: the stable construction of a pair around it, with no singular direction.
    frameAround(rows, ux, uy, uz)
    fx = rows[0]
    fy = rows[1]
    fz = rows[2]
    sx = rows[3]
    sy = rows[4]
    sz = rows[5]
  } else {
    // left = look × up, forward = up × left, each made unit.
    sx = ly * uz - lz * uy
    sy = lz * ux - lx * uz
    sz = lx * uy - ly * ux
    const sideLength = length3(sx, sy, sz) || 1
    sx /= sideLength
    sy /= sideLength
    sz /= sideLength
    fx = uy * sz - uz * sy
    fy = uz * sx - ux * sz
    fz = ux * sy - uy * sx
    const forwardLength = length3(fx, fy, fz) || 1
    fx /= forwardLength
    fy /= forwardLength
    fz /= forwardLength
  }
  put(out, at.forward, fx, fy, fz, 0)
  put(out, at.left, sx, sy, sz, 0)
}

/** The planet of a scene with no atmosphere, for the clouds: a sphere of radius `planetRadius`
 *  kilometres under the plane `y = 0`. The eye is not held anywhere over it, the clouds are marched
 *  from where the eye stands. */
export interface AirlessPlanet {
  readonly planetRadius: number
  readonly groundHeight: 0
  readonly groundPosition: readonly [0, 0]
  readonly airless: true
}

/** The planet a scene with no atmosphere is given, of radius `planetRadius` kilometres. */
export const airlessPlanet = (planetRadius: number): AirlessPlanet => ({
  planetRadius,
  groundHeight: 0,
  groundPosition: [0, 0],
  airless: true,
})

/** The place the sky is captured from: `capture.position`, scene metres, the origin where no place
 *  is given; the programs take it into the planet's frame, no lower than the eye is held
 *  (`sceneToPlanet`). The fourth lane is unused. */
function writeCapture(
  out: Float32Array,
  at: number,
  capture: { position: ArrayLike<number> } | undefined,
) {
  const p = capture?.position
  put(out, at, p?.[0] ?? 0, p?.[1] ?? 0, p?.[2] ?? 0, 0)
}

/**
 * Writes the image's frame into `out` (`FRAME_FLOATS` floats): the matrices, the eye on the planet
 * — its height above the centre in `camera.w` —, the table's axes, and the image's size. Nothing is
 * allocated. `camera.world` is the camera's world matrix, column-major: it looks down its own −z.
 * The table's axes are the camera's look made to lie across the planet's up at the eye
 * (`forward`, `left` its cross with the up), or, looking straight along the up, any orthonormal
 * pair around it. Over an atmosphere the eye is held no lower than just above the ground; over the
 * planet of a scene with none (`airlessPlanet`) it is where it stands.
 */
export function writeAirFrame(
  out: Float32Array,
  camera: { eye: ArrayLike<number>; world: ArrayLike<number>; perspective: number },
  air: ResolvedAtmosphere | AirlessPlanet,
  viewProj: ArrayLike<number>,
  inverseViewProj: ArrayLike<number>,
  width: number,
  height: number,
  extra: {
    capture?: { position: ArrayLike<number> }
    frameIndex?: number
    preExposure?: number
  } = {},
) {
  const at = FRAME_LAYOUT.at
  const radius = air.planetRadius
  const px = (camera.eye[0] - air.groundPosition[0]) / 1000,
    py = (camera.eye[1] - air.groundHeight) / 1000 + radius,
    pz = (camera.eye[2] - air.groundPosition[1]) / 1000
  const distance = length3(px, py, pz) || 1
  const held = 'airless' in air ? distance : Math.max(distance, radius + EYE_FLOOR)
  const ux = px / distance,
    uy = py / distance,
    uz = pz / distance
  const world = camera.world
  const [lx, ly, lz] = cameraForward(look, world)
  putAxes(out, at, ux, uy, uz, lx, ly, lz)
  out.set(inverseViewProj, at.inverseViewProj)
  out.set(viewProj, at.viewProj)
  put(out, at.camera, ux * held, uy * held, uz * held, held)
  put(out, at.up, ux, uy, uz, 0)
  const perspective = camera.perspective === 1
  put(out, at.eye, camera.eye[0], camera.eye[1], camera.eye[2], perspective ? 1 : 0)
  put(out, at.lift, 0, perspective ? 0 : orthographicLift(inverseViewProj), 0, 0)
  put(out, at.size, width, height, 1 / width, 1 / height)
  writeCapture(out, at.capture, extra.capture)
  put(out, at.preExposure, extra.preExposure ?? 1, 0, 0, 0)
  new Uint32Array(out.buffer, out.byteOffset + at.index * 4, 1)[0] = extra.frameIndex ?? 0
  return out
}
