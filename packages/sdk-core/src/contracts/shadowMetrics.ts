/** Why a shadow page turned stale (`ShadowFrameMetrics.shadowPagesStaledBy`). */
export type ShadowStaleReason = 'light' | 'caster' | 'moving' | 'detail' | 'threshold' | 'range';

/**
 * Lighting and shadow counters of a frame, split from `FrameMetrics` by responsibility.
 * `FrameMetrics` inherits them via `extends`: the public contract seen by consumers
 * (`sdk-core/index.ts`) is unchanged, these fields remain direct properties of `FrameMetrics`.
 */
export interface ShadowFrameMetrics {
  /** `SceneLight` contract lights that the frame lit. Null on an engine that ignores them. */
  lightsActive?: number | null;
  /** True when this frame's lighting ran in its sampled mode — a moving image accumulated on
   *  a history, where a pixel with more lights than `samplesPerPixel` shades a drawn subset —,
   *  false when every pixel shaded every light, as a still image does. Null on an engine that
   *  ignores the lights. */
  lightsSampled?: boolean | null;
  /** Shadow lights with a page drawn by this frame. Zero is the normal value of a still scene:
   *  a fixed light keeps its pages. */
  shadowsUpdated?: number | null;
  /**
   * GPU durations of the three direct-lighting passes, read by their label in the same
   * timestamp sample as `gpuPassMs`: per-tile light lists, shadow atlas, deferred resolve.
   * They therefore describe the frame of `gpuPassMs.frame`, not the current frame, and are `null` as
   * soon as the device exposes no timestamps, the sample was truncated, or the pass did not
   * run — a frame without a light launches neither lists nor shadows. Never added to a `cpu*`.
   */
  /** Light views the shadow pass drew in — a sun clipmap level, a lamp face at one mip —, and the
   *  draw calls actually encoded. Null on an engine that draws no shadow. */
  shadowFacesDrawn?: number | null;
  /** Shadow draw calls. */
  shadowDrawCalls?: number | null;
  /** Render passes the shadow pass opened: static layer, pool and transmittance, one per layer
   *  drawn, per batch. */
  shadowRenderPasses?: number | null;
  /** Cluster cuts run from the lights: one per light view drawn in, zero on a still frame. */
  shadowLightCuts?: number | null;
  /** Virtual shadow pages the image reads, as the frame's early demand named them — or, without
   *  it, the latest request report: what the camera's receivers mark. */
  shadowPagesRequested?: number | null;
  /** Of those, pages read straight from the pool: current, no draw. */
  shadowPagesCached?: number | null;
  /** Physical pages of the fixed pool that hold a virtual page. */
  shadowPoolPages?: number | null;
  /** GPU bytes of the shadow pool: its depth pages, their static and transmittance layers once
   *  made, and the buffers beside them. Null until the first frame sizes the pool. */
  shadowPoolBytes?: number | null;
  /** Layers of the pool, 4 096 pages each at most, sized once from the first frame's screen and
   *  shadowed lights. Null until then. */
  shadowPoolLayers?: number | null;
  /** The most GPU bytes the shadows' memory grant held at once, late layers included. Null until
   *  the first frame sizes the pool. */
  shadowPeakBytes?: number | null;
  /** Halvings of the shadow pool's bytes the device's out-of-memory refusals took; 0 normally. */
  shadowResolutionBias?: number | null;
  /** The shadows' memory-pressure events since the world opened, by name, in order; empty
   *  normally. */
  shadowMemoryEvents?: readonly string[] | null;
  /** Virtual pages mapped again after the pool evicted them to make room, since the explorer
   *  opened: the redraws a pool too small for what the frames read costs. */
  shadowPagesRefetched?: number | null;
  /** Casters the per-page cull kept, all drawn pages together, on the frame the device last
   *  sampled — one in fifteen; `null` until a sample has returned. */
  shadowCastersKept?: number | null;
  /** Moving casters the occlusion test found hidden behind the static layer of their page, on
   *  the frame the device last sampled; `null` until a sample has returned. */
  shadowCastersHidden?: number | null;
  /** What page invalidation produced: pages redrawn by the frame, pages left in the queue for
   *  lack of budget, and how long the oldest out-of-date page the image reads has waited. Zero
   *  everywhere is the normal value of a still scene; `null` on an engine without a shadow atlas. */
  shadowPagesDrawn?: number | null;
  /** Pages drawn since the explorer opened, drains of `flush()` included: what a change cost
   *  is the difference between two readings. */
  shadowPagesTotal?: number | null;
  /** Shadow pages waiting. */
  shadowPagesPending?: number | null;
  /** Shadow batches the frame drew: host counts of what it encoded, never read in a shader, as
   *  are the counts below. Null on an engine without a shadow atlas. */
  shadowBatches?: number | null;
  /** Pool layers the frame's shadow passes drew in. */
  shadowLayersDrawn?: number | null;
  /** Pages drawn from a copy of their static layer, their moving casters alone rasterised. */
  shadowPagesRestored?: number | null;
  /** Pages whose static casters were rasterised again; with the restored ones, every page drawn. */
  shadowPagesRasterized?: number | null;
  /** Page copies from the static layer: a restored page, or a page drawn in full over its layer. */
  shadowRestoreCopies?: number | null;
  /** Draw calls of static casters: into the static layer, or of a page drawn whole without one. */
  shadowStaticDrawCalls?: number | null;
  /** Draw calls of moving casters alone, over pages restored from the static layer. */
  shadowMovingDrawCalls?: number | null;
  /** Of `shadowCastersKept`, the clusters kept to draw moving casters alone. */
  shadowMovingCastersKept?: number | null;
  /** Pages the frame staled, by reason: light, still caster, moving casters, detail, cut threshold,
   *  or a sun's depth range. */
  shadowPagesStaledBy?: Readonly<Record<ShadowStaleReason, number>> | null;
  /** How many milliseconds the oldest out-of-date page the image reads has waited to be redrawn.
   *  Only the time the image reads it counts; 0 once it is redrawn. */
  shadowWaitMs?: number | null;
  /** Light-cut batches that dropped work — their views kept more clusters than the lists hold —,
   *  since the explorer opened: each sends its pages back, withdrawn until redrawn (#525). Null on
   *  an engine without the GPU light cut, as are the three below. */
  shadowCutDrops?: number | null;
  /** Pages drawn again because a light cut drew them wrong, since the explorer opened: its batch
   *  dropped work, or its flag was never read. They are withdrawn until redrawn. */
  shadowCutWithdrawnPages?: number | null;
  /** Pages drawn again because a view drew a cluster coarser than it wanted, since the explorer
   *  opened: released once residency changed and the camera rested. */
  shadowCutCoarsePages?: number | null;
  /** Light views one light-cut batch draws in now: the cap until a batch drops, then what fits. */
  shadowCutViewLimit?: number | null;
  /** GPU time of light lists. */
  gpuLightListsMs?: number | null;
  /** Words the tiles past their list reserved in the light-index pool, on the last sampled frame
   *  of a scene of more lights than a list; `null` otherwise (#849). */
  tileLightPoolReserved?: number | null;
  /** Words the light-index pool held on that sampled frame; `null` likewise. */
  tileLightPoolCapacity?: number | null;
  /** Whether a tile found no room in the pool on that sampled frame and walked every light. */
  tileLightPoolOverflowed?: boolean | null;
  /** Times the pool grew to what an overflowing frame asked, since the explorer opened. */
  tileLightPoolGrowths?: number | null;
  /** GPU time of shadows. */
  gpuShadowsMs?: number | null;
  /** GPU time of choosing the casters of the shadow pages a frame draws: the light cut, the
   *  per-page cull, and the occlusion test of moving casters with the pyramids it reads. */
  gpuShadowCullMs?: number | null;
  /** GPU time of drawing those casters into the pages: the static layer, then the pool. */
  gpuShadowRasterMs?: number | null;
  /** GPU time of lighting. */
  gpuLightingMs?: number | null;
}
