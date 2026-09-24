import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts';
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { raycast, type Intersection } from '../../../../sdk-core/src/world/object/raycast.ts';
import type { Ray } from '../../../../sdk-core/src/world/math/volumes.ts';
import { isHelper } from '../helper/mark.ts';
import { drawnAspect } from './worldCamera.ts';
import {
  asksPhysics,
  physicsRaycast,
  type PhysicsIntersection,
  type PhysicsRaycastOptions,
} from '../../physics/raycast.ts';
import type { PhysicsSession } from '../../physics/session.ts';

/** A point of the canvas, in CSS pixels from its top-left corner: `event.offsetX`, `offsetY`. */
export type CanvasPoint = {
  /** CSS pixels from the canvas's left edge. */
  x: number;
  /** CSS pixels from the canvas's top edge. */
  y: number;
};

/** What `world.raycast` may be told; every field is optional. */
export interface RaycastOptions {
  /** The objects tested, with their subtrees; unset, the whole scene. */
  objects?: readonly Object3D[];
}

/** The world ray through a canvas point, as the world's camera draws it: the point is read on
 *  the canvas's CSS box, the picture's shape is the drawing buffer's the frame is drawn at. */
export function canvasRay(camera: Camera, canvas: HTMLCanvasElement, at: CanvasPoint, out?: Ray) {
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  if (!(width > 0 && height > 0))
    throw new EngineError('RAYCAST_NO_VIEW', 'The canvas has no size to aim through', {
      width,
      height,
    });
  const [x, y] = [(at.x / width) * 2 - 1, 1 - (at.y / height) * 2];
  return camera.rayThrough(x, y, drawnAspect(canvas), out);
}

/**
 * The nearest object a canvas point or a world ray meets (`raycast`), on the CPU from the scene's
 * own geometry: the node the page added, the world point and normal, the distance. The `helper`
 * marks are never hit; a loaded model is hit on its box, its triangles living in GPU pages.
 * Asked `{ exact: true }` or `{ shape }`, the physics answers instead, asynchronously: a compiled
 * model is then hit on its cooked triangles (`physics.json`), a shape is swept (`physicsRaycast`).
 */
function worldRaycast(
  scene: Object3D,
  camera: Camera,
  canvas: HTMLCanvasElement,
  at: CanvasPoint | Ray,
  options?: RaycastOptions,
): Intersection | null;
function worldRaycast(
  scene: Object3D,
  camera: Camera,
  canvas: HTMLCanvasElement,
  at: CanvasPoint | Ray,
  options: PhysicsRaycastOptions,
  physics: PhysicsSession | null,
): Promise<PhysicsIntersection | null>;
function worldRaycast(
  scene: Object3D,
  camera: Camera,
  canvas: HTMLCanvasElement,
  at: CanvasPoint | Ray,
  options: RaycastOptions | PhysicsRaycastOptions = {},
  physics: PhysicsSession | null = null,
): Intersection | null | Promise<PhysicsIntersection | null> {
  const ray = (at as Ray).isRay ? (at as Ray) : canvasRay(camera, canvas, at as CanvasPoint);
  if (asksPhysics(options)) return physicsRaycast(physics, ray, options, camera.far);
  return raycast((options as RaycastOptions).objects ?? scene, ray, isHelper)[0] ?? null;
}

/**
 * `world.raycast` for one world — its scene, its camera as it stands, its physics when on: at once
 * from the scene's own geometry, or, asked `{ exact: true }` or `{ shape }` (a sphere, box or
 * capsule swept along the ray; `maxDistance` defaults to the camera's `far`), by the physics, the
 * hit then naming the glTF `material` of a cooked triangle. The type is spelled out: the physics'
 * option types stay inside the engine.
 */
export const createWorldRaycast = (
  scene: Object3D,
  camera: () => Camera,
  canvas: HTMLCanvasElement,
  physics: () => PhysicsSession | null,
) =>
  ((at: CanvasPoint | Ray, options?: RaycastOptions | PhysicsRaycastOptions) =>
    worldRaycast(scene, camera(), canvas, at, options as never, physics())) as {
    (at: CanvasPoint | Ray, options?: RaycastOptions): Intersection | null;
    (
      at: CanvasPoint | Ray,
      options: {
        exact?: true;
        shape?:
          | { type: 'sphere'; radius: number }
          | { type: 'box'; halfExtents: { x: number; y: number; z: number } }
          | { type: 'capsule'; halfHeight: number; radius: number };
        maxDistance?: number;
      },
    ): Promise<(Intersection & { material: number }) | null>;
  };
