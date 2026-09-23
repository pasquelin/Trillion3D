import type { World } from '../core/world.ts';

/**
 * The `budget` family: the fixed envelopes the engine does not exceed. `memory(world)` is what the
 * world holds now (`world.budget`); the two pools build the setting a world takes.
 */
export const budget = {
  memory: ({ budget: b }: World) => ({
    geometryPool: b.geometryPool,
    texturePool: b.texturePool,
    geometryPoolCeiling: b.geometryPoolCeiling,
    texturePoolCeiling: b.texturePoolCeiling,
  }),
  geometryPool: (bytes: number) => ({ geometryPool: bytes }),
  texturePool: (bytes: number) => ({ texturePool: bytes }),
};
