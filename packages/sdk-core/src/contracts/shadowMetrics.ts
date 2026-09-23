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
  /** Cluster cuts run from the lights: one per light view drawn in, zero on a still frame. */
  shadowLightCuts?: number | null;
  /** Virtual shadow pages the image read, as its latest request report named them: what the
   *  camera's receivers mark. */
  shadowPagesRequested?: number | null;
  /** Of those, pages read straight from the pool: current, no draw. */
  shadowPagesCached?: number | null;
  /** Physical pages of the fixed pool that hold a virtual page. */
  shadowPoolPages?: number | null;
  /** Casters the per-page cull kept, all drawn pages together, on the frame the device last
   *  sampled — one in fifteen; `null` until a sample has returned. */
  shadowCastersKept?: number | null;
  /** Moving casters the occlusion test found hidden behind the static layer of their page, on
   *  the frame the device last sampled; `null` until a sample has returned. */
  shadowCastersHidden?: number | null;
  /** What page invalidation produced: pages redrawn by the frame, pages left in
   *  the queue for lack of budget, and the lag in milliseconds of the oldest of them. Zero
   *  everywhere is the normal value of a still scene; `null` on an engine without a shadow atlas. */
  shadowPagesDrawn?: number | null;
  /** Pages drawn since the explorer opened, drains of `flush()` included: what a change cost
   *  is the difference between two readings. */
  shadowPagesTotal?: number | null;
  /** Shadow pages waiting. */
  shadowPagesPending?: number | null;
  /** How long they waited. */
  shadowWaitMs?: number | null;
  /** GPU time of light lists. */
  gpuLightListsMs?: number | null;
  /** GPU time of shadows. */
  gpuShadowsMs?: number | null;
  /** GPU time of lighting. */
  gpuLightingMs?: number | null;
}
