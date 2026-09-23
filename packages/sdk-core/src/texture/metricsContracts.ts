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
  texturePoolFormat?: string | null;
  texturePoolLayers?: number | null;
  textureTilesResident?: number | null;
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
  textureTilesAtLevel?: number | null;
  textureMissingLevels?: number | null;
  textureTilesPending?: number | null;
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
  textureTilesEvicted?: number | null;
  textureTilesRefused?: number | null;
  textureBytesLastFrame?: number | null;
  textureUploadMs?: number | null;
  textureUploadPeakMs?: number | null;
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
