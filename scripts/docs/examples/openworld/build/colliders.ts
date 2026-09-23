/**
 * Physics colliders beside the cache (the play kit's `collision.ts` has the format): one
 * collision mesh per solid prop (`collision.ts` here), and per tile the placements of those
 * meshes whose origin it holds. Plants are walked through; the terrain is the heightfield.
 */
import {
  scaleOf,
  type ColliderInstance,
  type CollisionMesh,
} from '../../../../../site/examples/kit/openworld/play/collision.ts';
import type { Instance, PropMesh } from '../plan/contract.ts';
import { collisionMeshes } from './collision.ts';

export type SolidColliders = {
  shapes: ReadonlyMap<string, CollisionMesh>;
  placed: readonly ColliderInstance[];
};

/** The solid props' meshes by id, and every placement of one. */
export function solidColliders(
  meshes: readonly PropMesh[],
  instances: readonly Instance[],
): SolidColliders {
  const shapes = collisionMeshes(meshes, instances),
    placed = instances
      .filter((instance) => shapes.has(instance.prop))
      .map(({ prop, position, yaw, scale }) => ({ prop, position, yaw, scale: scaleOf(scale) }));
  return { shapes, placed };
}

/** Placements per tile key `<tx>_<tz>`, for a world of `size` metres cut in `tile` metre tiles. */
export function tileColliders(placed: readonly ColliderInstance[], size: number, tile: number) {
  const tiles = new Map<string, ColliderInstance[]>();
  for (const instance of placed) {
    const [x, , z] = instance.position,
      key = `${Math.floor((x + size / 2) / tile)}_${Math.floor((z + size / 2) / tile)}`;
    const list = tiles.get(key) ?? [];
    list.push(instance);
    tiles.set(key, list);
  }
  return tiles;
}
