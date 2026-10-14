import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import type { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { Ray } from '../../../../sdk-core/src/world/math/volumes.ts'
import type { Engine } from '../../engine/types.ts'
import type { Intersection } from '../query/types.ts'
import { helperRoots } from './helperMark.ts'
import { drawnAspect } from './worldCamera.ts'
import { asksPhysics, physicsRaycast, type PhysicsRaycastOptions } from '../../physics/raycast.ts'
import type { PhysicsSession } from '../../physics/session/session.ts'

/** A point of the canvas, in CSS pixels from its top-left corner: `event.offsetX`, `offsetY`. */
export type CanvasPoint = {
  /** CSS pixels from the canvas's left edge. */
  x: number
  /** CSS pixels from the canvas's top edge. */
  y: number
}

/** What `world.raycast` may be told; every field is optional. */
export interface RaycastOptions {
  /** The objects tested, with their subtrees; unset, the whole scene. */
  objects?: readonly Object3D[]
  /** The `helper` marks are met too — a transform control's handles —; passed by otherwise. */
  helpers?: boolean
}

/** The world ray through a canvas point, as the world's camera draws it: the point is read on
 *  the canvas's CSS box, the picture's shape is the drawing buffer's the frame is drawn at. */
export function canvasRay(camera: Camera, canvas: HTMLCanvasElement, at: CanvasPoint, out?: Ray) {
  const width = canvas.clientWidth,
    height = canvas.clientHeight
  if (!(width > 0 && height > 0))
    throw new EngineError('RAYCAST_NO_VIEW', 'The canvas has no size to aim through', {
      width,
      height,
    })
  const [x, y] = [(at.x / width) * 2 - 1, 1 - (at.y / height) * 2]
  return camera.rayThrough(x, y, drawnAspect(canvas), out)
}

/** The world ray `at` names — a canvas point through the camera, or a ray —, its direction a unit
 *  vector, so every distance is in world units whatever length the page gave it. */
function worldRay(camera: Camera, canvas: HTMLCanvasElement, at: CanvasPoint | Ray) {
  const ray = (at as Ray).isRay ? (at as Ray) : canvasRay(camera, canvas, at as CanvasPoint)
  return new Ray(ray.origin.clone(), ray.direction.clone().normalize())
}

/**
 * `world.raycast` for one world — its camera as it stands, its session's engine, its physics when
 * on —, always a promise. By default the engine's ray query answers (`Engine.castRay`): the nearest
 * triangle the world draws, at the finest detail it holds — a loaded model on its own triangles, a
 * deformed mesh where it is drawn —, traced on the GPU with every ray cast in the same tick and
 * answered a frame or so later, the main thread never waiting. The `helper` marks are passed by
 * unless asked (`helpers`), lines, points and sprites always; a world whose session is not open
 * answers `null`, a sizeless canvas rejects (`RAYCAST_NO_VIEW`). Asked `{ exact: true }` or
 * `{ shape }` (a sphere, box or capsule swept along the ray; `maxDistance` defaults to the camera's
 * `far`), the physics answers instead, on its collision shapes and cooked triangles, the hit then
 * naming the glTF `material` of a cooked triangle. The type is spelled out: the physics' option
 * types stay inside the engine.
 */
export const createWorldRaycast = (
  camera: () => Camera,
  canvas: HTMLCanvasElement,
  physics: () => PhysicsSession | null,
  engine: () => Engine | undefined,
) =>
  (async (at: CanvasPoint | Ray, options: RaycastOptions | PhysicsRaycastOptions = {}) => {
    const ray = worldRay(camera(), canvas, at)
    if (asksPhysics(options)) return physicsRaycast(physics(), ray, options, camera().far)
    const { objects, helpers } = options as RaycastOptions
    const skip = helpers ? [] : helperRoots()
    return (await engine()?.castRay(ray, { objects, skip })) ?? null
  }) as {
    (at: CanvasPoint | Ray, options?: RaycastOptions): Promise<Intersection | null>
    (
      at: CanvasPoint | Ray,
      options: {
        exact?: true
        shape?:
          | { type: 'sphere'; radius: number }
          | { type: 'box'; halfExtents: { x: number; y: number; z: number } }
          | { type: 'capsule'; halfHeight: number; radius: number }
        maxDistance?: number
        ignore?: Object3D
      },
    ): Promise<(Intersection & { material: number }) | null>
  }
