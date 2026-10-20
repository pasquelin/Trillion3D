/**
 * The `budget` family: the pool settings a world takes. What a world holds now is its own
 * `world.budget` (totals, split, pools, ceilings, canvas), read there.
 */
export const budget = {
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
}
