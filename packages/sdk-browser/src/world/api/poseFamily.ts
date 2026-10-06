import { framingFromBounds } from '../../camera/framing.ts';
import { runCameraPath } from '../../camera/path.ts';
import type { CameraPose as EnginePose } from '../../../../sdk-core/src/index.ts';
import type { Box3 } from '../../../../sdk-core/src/world/math/box3.ts';
import { Vector3, readVec3, type Vec3Input } from '../../../../sdk-core/src/world/math/vector3.ts';
import type { CameraPose } from '../../../../sdk-core/src/world/camera/camera.ts';
import { sessionOf } from '../core/worldSession.ts';

/** What a path is replayed through: a world and its camera. */
export type PosedWorld = {
  /** The camera's field of view and near and far distances. */
  camera: { fov: number; near: number; far: number };
};

/** The `pose` family: framing a box, naming a view, replaying a path. */
export const pose = {
  /**
   * The view that frames `box` (`framingFromBounds`), from `direction` (the default diagonal).
   * @param box - The box to frame.
   * @param p - The field of view, the direction to look from, and the picture's shape.
   */
  fromBounds(
    box: Box3,
    p: { fov?: number; direction?: Vec3Input; aspect?: number } = {},
  ): CameraPose {
    // An empty box frames its origin at no distance, not at the empty sphere's radius of −1.
    const sphere = box.getBoundingSphere({ center: new Vector3(), radius: 0 });
    const centre = sphere.center,
      radius = Math.max(0, sphere.radius);
    const framing = framingFromBounds(radius, p.aspect ?? 1);
    const along = p.direction
      ? new Vector3(...readVec3(p.direction))
      : new Vector3(...framing.offset);
    along.setLength(new Vector3(...framing.offset).length());
    return {
      position: centre.clone().add(along).toArray(),
      target: centre.toArray(),
      fov: p.fov,
    };
  },
  /**
   * A view with a name, so a page can come back to it.
   * @param name - The view's name.
   * @param p - The view.
   */
  pointOfInterest: (name: string, p: CameraPose) => ({ ...p, name }),
  /**
   * Replays the views `poses` through the world (`runCameraPath`), `images` frames spread evenly
   * over them, eye and target moving in straight lines between two views.
   * @param world - The world to move.
   * @param poses - The views to pass through.
   * @param p - How many frames the whole path takes.
   */
  async runPath(world: PosedWorld, poses: CameraPose[], p: { images?: number } = {}) {
    const images = Math.max(poses.length, p.images ?? poses.length);
    const { camera } = world;
    const at = (t: number): EnginePose => {
      const span = t * (poses.length - 1),
        i = Math.min(poses.length - 2, Math.floor(span)),
        w = poses.length < 2 ? 0 : span - i;
      const a = poses[Math.max(0, i)],
        b = poses[Math.min(poses.length - 1, i + 1)];
      const mix = (u: Vec3Input, v: Vec3Input) =>
        new Vector3(...readVec3(u)).lerp(new Vector3(...readVec3(v)), w).toArray();
      return {
        position: mix(a.position, b.position),
        target: mix(a.target, b.target),
        fov: a.fov ?? camera.fov,
        near: camera.near,
        far: camera.far,
      };
    };
    const path = Array.from({ length: images }, (_, k) => at(images === 1 ? 0 : k / (images - 1)));
    await runCameraPath(sessionOf(world), path);
  },
};
