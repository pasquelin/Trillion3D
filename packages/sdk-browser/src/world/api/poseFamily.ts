import { frameBounds } from '../../camera/framing.ts'
import { runCameraPath } from '../../camera/path.ts'
import type { CameraPose as EnginePose } from '../../../../sdk-core/src/contracts/base.ts'
import type { Box3 } from '../../../../sdk-core/src/world/math/box3.ts'
import { Vector3, readVec3, type Vec3Input } from '../../../../sdk-core/src/world/math/vector3.ts'
import type { CameraPose } from '../../../../sdk-core/src/world/camera/camera.ts'
import { sessionOf } from '../core/worldSession.ts'

/** What a path is replayed through: a world and its camera. */
export type PosedWorld = {
  /** The camera's field of view and near and far distances. */
  camera: { fov: number; near: number; far: number }
}

/** The `pose` family: framing a box, naming a view, replaying a path. */
export const pose = {
  /**
   * The view that frames `box` (`frameBounds`), from `direction` (the default diagonal).
   * @param box - The box to frame.
   * @param p - The field of view, the direction to look from, and the picture's shape.
   */
  fromBounds(
    box: Box3,
    p: { fov?: number; direction?: Vec3Input; aspect?: number } = {},
  ): CameraPose {
    const { min, max } = box
    const flat = Float64Array.of(min.x, min.y, min.z, max.x, max.y, max.z)
    const framed = frameBounds(flat, p.aspect ?? 1, p.direction && readVec3(p.direction))
    return {
      position: framed.position,
      target: framed.centre,
      fov: p.fov,
    }
  },
  /**
   * A view with a name, so a page can come back to it.
   * @param name - The view's name.
   * @param p - The view.
   */
  pointOfInterest: (name: string, p: CameraPose) => ({ ...p, name }),
  /**
   * Replays the views `poses` through the world (`runCameraPath`), `images` frames spread evenly
   * over them, eye and target moving in straight lines between two views, one display frame each:
   * the frames drawn, their CPU time summarized, and the display cadence.
   * @param world - The world to move.
   * @param poses - The views to pass through.
   * @param p - How many frames the whole path takes.
   */
  async runPath(world: PosedWorld, poses: CameraPose[], p: { images?: number } = {}) {
    const images = Math.max(poses.length, p.images ?? poses.length)
    const { camera } = world
    const at = (t: number): EnginePose => {
      const span = t * (poses.length - 1),
        i = Math.min(poses.length - 2, Math.floor(span)),
        w = poses.length < 2 ? 0 : span - i
      const a = poses[Math.max(0, i)],
        b = poses[Math.min(poses.length - 1, i + 1)]
      const mix = (u: Vec3Input, v: Vec3Input) =>
        new Vector3(...readVec3(u)).lerp(new Vector3(...readVec3(v)), w).toArray()
      return {
        position: mix(a.position, b.position),
        target: mix(a.target, b.target),
        fov: a.fov ?? camera.fov,
        near: camera.near,
        far: camera.far,
      }
    }
    const path = Array.from({ length: images }, (_, k) => at(images === 1 ? 0 : k / (images - 1)))
    return runCameraPath(sessionOf(world), path)
  },
}
