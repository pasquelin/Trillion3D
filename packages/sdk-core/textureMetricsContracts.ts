/**
 * What virtual textures publish on a frame: the pool, the tiles, the image feedback.
 *
 * These fields live apart from `FrameMetrics` because they describe another queue than the frame:
 * tiles arrive at their own pace, bounded by bytes and by frame, and the pool is sized
 * once. All optional: an engine without textures leaves them absent, `null` says "unmeasured",
 * never an estimate.
 */
export interface TextureFrameMetrics {
  /**
   * The physical pool, fixed for the session: its bytes — COMPUTED from its dimensions and
   * format, WebGPU not publishing occupied memory —, the colour atlas's format (`bc7-…`,
   * `astc-4x4-…` when the device samples a block format and every texture has its baked chain,
   * `rgba8unorm-srgb` otherwise), its layers per atlas, and what it holds. `texturePoolBytes`
   * does not depend on the scene; `textureResidentBytes` is the occupied share, pinned tails
   * included.
   */
  texturePoolBytes?: number | null;
  texturePoolFormat?: string | null;
  texturePoolLayers?: number | null;
  textureTilesResident?: number | null;
  textureResidentBytes?: number | null;
  /**
   * Image feedback: what the pixels asked for at the last sample. `textureTilesRequested`:
   * distinct named tiles; `textureTilesAtLevel`: those served at the very level the pixel
   * calls; `textureMissingLevels`: lag levels on average over the requested tiles — zero
   * when the image is the best the pool can give; `textureTilesPending`: requested
   * and not yet served at the end of the pass.
   */
  textureTilesRequested?: number | null;
  textureTilesAtLevel?: number | null;
  textureMissingLevels?: number | null;
  textureTilesPending?: number | null;
  /**
   * The streamer, since the start of the session. `textureTilesServed`: tiles copied into the pool.
   * `textureTilesEvicted`: slots taken back from a less-watched tile. `textureTilesRefused`:
   * tiles that no slot could take, everything the pool holds having been watched in
   * the frame — the pool is too small for the view, and that is published, never compensated.
   * `textureBytesLastFrame`: tile bytes admitted by the last pass.
   */
  textureTilesServed?: number | null;
  textureTilesEvicted?: number | null;
  textureTilesRefused?: number | null;
  textureBytesLastFrame?: number | null;
  /**
   * The sources. `textureLevelReads`: baked levels being read in the cache. `textureLevelsDecoded`:
   * baked levels decoded since the start. `textureLevelCacheBytes`: host bytes of decoded
   * levels held to cut further tiles from them, under a fixed budget. `textureScratchBuilds`:
   * work textures built for a texture without a baked chain, the whole source each time.
   */
  textureLevelReads?: number | null;
  textureLevelsDecoded?: number | null;
  textureLevelCacheBytes?: number | null;
  textureScratchBuilds?: number | null;
}
