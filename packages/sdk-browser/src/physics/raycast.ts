import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import { CAST, CAST_WORDS, MISS } from '../../../sdk-core/src/physics/index.ts';
import type { Intersection } from '../../../sdk-core/src/world/object/raycast.ts';
import type { Ray } from '../../../sdk-core/src/world/math/volumes.ts';
import { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import type { PhysicsSession } from './session.ts';

/** A shape swept along a ray (`world.raycast(at, { shape })`): what it first touches is the hit. */
type SweptShape =
  | { type: 'sphere'; radius: number }
  | { type: 'box'; halfExtents: { x: number; y: number; z: number } }
  | { type: 'capsule'; halfHeight: number; radius: number };

/** `world.raycast` asked of the physics: exact on compiled models — the triangles their cooked
 *  tiles hold —, on every body, and able to sweep a shape. */
export interface PhysicsRaycastOptions {
  /** Answer from the physics. Implied by `shape`. */
  exact?: true;
  /** A shape swept along the ray instead of a ray. */
  shape?: SweptShape;
  /** How far the ray reaches, world units. @defaultValue the camera's `far` */
  maxDistance?: number;
}

/** A physics hit: the object — the compiled model, or the mesh of a body —, and the glTF material
 *  of the cooked triangle hit, `-1` when the shape carries none. */
export type PhysicsIntersection = Intersection & { material: number };

/** Whether `world.raycast` options ask the physics. */
export const asksPhysics = (options: unknown): options is PhysicsRaycastOptions =>
  !!options && typeof options === 'object' && ('exact' in options || 'shape' in options);

/**
 * One query against the simulation, between two steps (`jolt_cast`): the nearest hit along the
 * ray, or `null`. The physics must be on: the tiles it tests are the ones it streams.
 */
export async function physicsRaycast(
  session: PhysicsSession | null,
  ray: Ray,
  options: PhysicsRaycastOptions,
  far: number,
): Promise<PhysicsIntersection | null> {
  if (!session)
    throw new EngineError('PHYSICS_OFF', 'An exact raycast asks the physics: turn it on first.');
  const reach = options.maxDistance ?? far;
  const words = new Uint32Array(CAST_WORDS);
  const floats = new Float32Array(words.buffer);
  const shape = options.shape;
  words[0] = shape ? CAST[shape.type] : CAST.ray;
  floats.set([ray.origin.x, ray.origin.y, ray.origin.z], 1);
  floats.set([ray.direction.x * reach, ray.direction.y * reach, ray.direction.z * reach], 4);
  if (shape?.type === 'sphere') floats[7] = shape.radius;
  else if (shape?.type === 'box')
    floats.set([shape.halfExtents.x, shape.halfExtents.y, shape.halfExtents.z], 7);
  else if (shape) floats.set([shape.halfHeight, shape.radius], 7);
  const hit = await session.cast(words);
  const object: Object3D | null = hit[0] === MISS ? null : session.objectOf(hit[0]);
  if (!object) return null;
  const f = new Float32Array(hit.buffer);
  return {
    object,
    point: new Vector3(f[2], f[3], f[4]),
    normal: new Vector3(f[5], f[6], f[7]),
    distance: f[1] * reach,
    face: -1,
    material: hit[8] === MISS ? -1 : hit[8],
  };
}
