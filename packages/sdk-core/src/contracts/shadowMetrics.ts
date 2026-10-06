/**
 * Lighting and shadow counters of a frame, split from `FrameMetrics` by responsibility.
 * `FrameMetrics` inherits them via `extends`: the public contract seen by consumers
 * (`../index.ts`) is unchanged, these fields remain direct properties of `FrameMetrics`.
 */
export interface ShadowFrameMetrics {
  /** Virtual shadow maps: lights shadowed this frame. */
  shadowVsmLights?: number | null
  /** Virtual shadow maps this frame, full and single-page. */
  shadowVsmMaps?: number | null
  /** Pages the frame marked as requested; read back a few frames late. */
  shadowVsmPagesRequested?: number | null
  /** Pages newly allocated this frame; read back a few frames late. */
  shadowVsmPagesAllocated?: number | null
  /** Requested pages found in the cache, static and dynamic; read back a few frames late. */
  shadowVsmPagesCached?: number | null
  /** Pages cleared then rendered this frame; read back a few frames late. */
  shadowVsmPagesRendered?: number | null
  /** Free physical pages in the pool's last status message. */
  shadowVsmFreePages?: number | null
  /** The global resolution LOD bias the pool's load sets. */
  shadowVsmLodBias?: number | null
  /** Projection passes this frame, four lights each. */
  shadowVsmProjectionPasses?: number | null
  /** GPU time of the page invalidation, ms, from the pass timings. */
  shadowVsmInvalidationMs?: number | null
  /** GPU time of the page marking, ms, from the pass timings. */
  shadowVsmMarkingMs?: number | null
  /** GPU time of the page management, ms, from the pass timings. */
  shadowVsmPageManagementMs?: number | null
  /** GPU time of the page rendering, ms, from the pass timings. */
  shadowVsmRenderMs?: number | null
  /** GPU time of the shadow projection, ms, from the pass timings. */
  shadowVsmProjectionMs?: number | null
  /** GPU time of the translucent casters' transmission atlas (clear, draw, resolve), ms. */
  shadowVsmTransmissionMs?: number | null
  /** `SceneLight` contract lights that the frame lit. Null on an engine that ignores them. */
  lightsActive?: number | null
  /** True when this frame's lighting ran in its sampled mode — a moving image accumulated on
   *  a history, where a pixel with more lights than `samplesPerPixel` shades a drawn subset —,
   *  false when every pixel shaded every light, as a still image does. Null on an engine that
   *  ignores the lights. */
  lightsSampled?: boolean | null
  /**
   * GPU durations of the three direct-lighting passes, read by their label in the same
   * timestamp sample as `gpuPassMs`: per-tile light lists, shadow atlas, deferred resolve.
   * They therefore describe the frame of `gpuPassMs.frame`, not the current frame, and are `null` as
   * soon as the device exposes no timestamps, the sample was truncated, or the pass did not
   * run — a frame without a light launches neither lists nor shadows. Never added to a `cpu*`.
   */
  /** GPU bytes of the shadow pool: its depth pages, their static and transmittance layers once
   *  made, and the buffers beside them. Null until the first frame sizes the pool. */
  shadowPoolBytes?: number | null
  /** How far the shadows draw coarser than they ask because of their page pool: the halvings the
   *  GPU budget took off the full pool, plus the levels its fill raised every map's resolution
   *  bias by (`shadowVsmLodBias`). 0 normally; above 0, the engine's reference mode refuses its capture
   *  (`REFERENCE_SHADOWS_REDUCED`). Null while no shadow map runs. */
  shadowResolutionBias?: number | null
  /** GPU time of light lists. */
  gpuLightListsMs?: number | null
  /** Words the tiles past their list reserved in the light-index pool, on the last sampled frame
   *  of a scene of more lights than a list; `null` otherwise (#849). */
  tileLightPoolReserved?: number | null
  /** Words the light-index pool held on that sampled frame; `null` likewise. */
  tileLightPoolCapacity?: number | null
  /** Whether a tile found no room in the pool on that sampled frame and walked every light. */
  tileLightPoolOverflowed?: boolean | null
  /** Times the pool grew to what an overflowing frame asked, since the explorer opened. */
  tileLightPoolGrowths?: number | null
  /** GPU time of the Shadows stage, exactly the shadow passes of the engine's pass table: the
   *  shadow atlas, its static layer, the transmittance layer's clear and pass, the per-page cull,
   *  the page pyramids and the occlusion test. The light cut is its own stage (`shadowCasters`);
   *  no pass outside the shadow work is counted in it. */
  gpuShadowsMs?: number | null
  /** GPU time of choosing the casters of the shadow pages a frame draws: the light cut, the
   *  per-page cull, and the occlusion test of moving casters with the pyramids it reads. */
  gpuShadowCullMs?: number | null
  /** GPU time of drawing those casters into the pages: the static layer, then the pool. */
  gpuShadowRasterMs?: number | null
  /** GPU time of lighting. */
  gpuLightingMs?: number | null
}
