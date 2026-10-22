import { fieldLayout, putVec4 as put } from '../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import { cameraForward } from '../../camera/forward.ts'
import type { ResolvedAtmosphere } from '../../../../sdk-core/src/scene/core/atmosphere.ts'
import { topRadiusOf } from '../../../../sdk-core/src/scene/core/atmosphereOptics.ts'

/**
 * WHAT THE AIR'S PROGRAMS KNOW OF AN IMAGE: where the eye stands on the planet and how it is
 * turned, and the camera's matrices — one uniform, written each image (`writeAirFrame`).
 *
 * The planet's ground is the scene's plane `y = groundHeight`; the planet is a sphere under it,
 * lengths in kilometres. The eye is lifted onto the ground if it dips below, so that the sky is
 * always seen, and held under the top of the air. The sky is drawn from a table around the eye in
 * its own frame, whose up is the planet's at the eye and whose forward is the camera's, turned
 * to be across the up: `forward`, `left` and `up` are the table's three axes in the scene.
 */
const FRAME_LAYOUT = fieldLayout('AirFrame', [
  ['inverseViewProj', 'mat4x4f'],
  ['viewProj', 'mat4x4f'],
  ['camera', 'vec4f'],
  ['forward', 'vec4f'],
  ['left', 'vec4f'],
  ['up', 'vec4f'],
  ['eye', 'vec4f'],
  ['size', 'vec4f'],
] as const)
/** The frame's words. */
export const FRAME_FLOATS = FRAME_LAYOUT.words
/** `camera` holds the eye relative to the planet's centre, kilometres, and its distance from it;
 *  `eye` the eye in the scene, metres, and 1 for a perspective view (0: the air is not drawn);
 *  `size` the image's pixels and their inverse. */
export const FRAME_WGSL = wgslBlock('FRAME_WGSL', [], FRAME_LAYOUT.wgsl)

/** How far above the ground the eye is held, kilometres: the sky is seen from the surface, never
 *  from inside the planet. */
/** The unit forward of the camera the frame is written for, rewritten each image. */
const look = new Float64Array(3)
const EYE_FLOOR = 0.005
/** How far under the top of the air the eye is held, kilometres: the tables describe a view from
 *  inside the air. */
const EYE_CEILING = 0.001

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
    const sign = uz >= 0 ? 1 : -1
    const a = -1 / (sign + uz),
      b = ux * uy * a
    fx = 1 + sign * a * ux * ux
    fy = sign * b
    fz = -sign * ux
    sx = b
    sy = sign + a * uy * uy
    sz = -uy
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

/**
 * Writes the image's frame into `out` (`FRAME_FLOATS` floats): the matrices, the eye on the planet
 * — its height above the centre in `camera.w` —, the table's axes, and the image's size. Nothing is
 * allocated. `camera.world` is the camera's world matrix, column-major: it looks down its own −z.
 * The table's axes are the camera's look made to lie across the planet's up at the eye
 * (`forward`, `left` its cross with the up), or, looking straight along the up, any orthonormal
 * pair around it.
 */
export function writeAirFrame(
  out: Float32Array,
  camera: { eye: ArrayLike<number>; world: ArrayLike<number>; perspective: number },
  air: ResolvedAtmosphere,
  viewProj: ArrayLike<number>,
  inverseViewProj: ArrayLike<number>,
  width: number,
  height: number,
) {
  const at = FRAME_LAYOUT.at
  const radius = air.planetRadius,
    top = topRadiusOf(air)
  const px = camera.eye[0] / 1000,
    py = (camera.eye[1] - air.groundHeight) / 1000 + radius,
    pz = camera.eye[2] / 1000
  const distance = length3(px, py, pz) || 1
  const held = clamp(distance, radius + EYE_FLOOR, top - EYE_CEILING)
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
  put(out, at.eye, camera.eye[0], camera.eye[1], camera.eye[2], camera.perspective === 1 ? 1 : 0)
  put(out, at.size, width, height, 1 / width, 1 / height)
  return out
}
