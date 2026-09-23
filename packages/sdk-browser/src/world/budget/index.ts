import type { World } from '../core/world.ts';

/**
 * The `budget` family: the fixed envelopes the engine does not exceed. `memory(world)` is what the
 * world holds now (`world.budget`); the two pools build the setting a world takes.
 */
export const budget = {
  /** The memory budgets a world holds right now: both pools and the largest each may grow to. */
  memory: ({ budget: b }: World) => ({
    geometryPool: b.geometryPool,
    texturePool: b.texturePool,
    geometryPoolCeiling: b.geometryPoolCeiling,
    texturePoolCeiling: b.texturePoolCeiling,
  }),
  /**
   * A geometry pool setting of `bytes`, ready to hand to a world.
   * @param bytes - Bytes for geometry pages.
   */
  geometryPool: (bytes: number) => ({ geometryPool: bytes }),
  /**
   * A texture pool setting of `bytes`, ready to hand to a world.
   * @param bytes - Bytes for texture tiles.
   */
  texturePool: (bytes: number) => ({ texturePool: bytes }),
};
