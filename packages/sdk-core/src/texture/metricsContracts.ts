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
   * The physical pools, fixed for the session: their bytes — COMPUTED from their dimensions and
   * formats, WebGPU not publishing occupied memory —, the block family the session samples
   * (`bc7`, `astc`, or `rgba8` when the device samples neither or the host asked for none), the
   * layers of every lane pool of both atlases added up, and what they hold. `texturePoolBytes`
   * depends on the budget and on which lanes the scene's chains take; `textureResidentBytes` is
   * the occupied share, pinned tails included, at each lane's own texel cost.
   */
  texturePoolBytes?: number | null;
  /** Format of the texture pool. */
  texturePoolFormat?: string | null;
  /** Layers in the pool. */
  texturePoolLayers?: number | null;
  /** Tiles held. */
  textureTilesResident?: number | null;
  /** Bytes held. */
  textureResidentBytes?: number | null;
  /**
   * Image feedback: what the pixels asked for at the last sample. `textureTilesRequested`:
   * distinct named tiles; `textureTilesAtLevel`: those served at the very level the pixel
   * calls; `textureMissingLevels`: lag levels on average over the requested tiles — zero
   * when the image is the best the pool can give; `textureTilesPending`: requested
   * and not yet served at the end of the pass; `textureTilesDeferred`: the share of them the
   * pass's budget pushed to the next pass, their coarser level shown meanwhile.
   */
  textureTilesRequested?: number | null;
  /** Tiles at the level asked. */
  textureTilesAtLevel?: number | null;
  /** Levels still missing. */
  textureMissingLevels?: number | null;
  /** Tiles on their way. */
  textureTilesPending?: number | null;
  /** Tiles put off to a later frame. */
  textureTilesDeferred?: number | null;
  /**
   * The streamer, since the start of the session. `textureTilesServed`: tiles copied into the pool.
   * `textureTilesEvicted`: slots taken back from a less-watched tile. `textureTilesRefused`:
   * tiles that no slot could take, everything the pool holds having been watched in
   * the frame — the pool is too small for the view, and that is published, never compensated.
   * `textureBytesLastFrame`: tile bytes admitted by the last pass. `textureUploadMs`: CPU
   * milliseconds of the last pass, `null` when it had nothing to serve or when a barrier lifted
   * its budget; `textureUploadPeakMs`: the worst budgeted pass since the start — a stutter is a
   * peak, never a median.
   */
  textureTilesServed?: number | null;
  /** Tiles removed. */
  textureTilesEvicted?: number | null;
  /** Tiles refused. */
  textureTilesRefused?: number | null;
  /** Bytes sent last frame. */
  textureBytesLastFrame?: number | null;
  /** Time spent sending tiles. */
  textureUploadMs?: number | null;
  /** Longest send in one frame. */
  textureUploadPeakMs?: number | null;
  /**
   * The sources. `textureLevelReads`: baked levels being read in the cache. `textureLevelsDecoded`:
   * baked levels decoded since the start. `textureLevelCacheBytes`: host bytes of decoded
   * levels held to cut further tiles from them, under a fixed budget. `textureScratchBuilds`:
   * work textures built for a texture without a baked chain, the whole source each time.
   */
  textureLevelReads?: number | null;
  /** Levels decoded. */
  textureLevelsDecoded?: number | null;
  /** Bytes of decoded levels kept. */
  textureLevelCacheBytes?: number | null;
  /** Scratch textures built. */
  textureScratchBuilds?: number | null;
}
