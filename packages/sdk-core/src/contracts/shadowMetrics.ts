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
  /** Shadow slices redrawn by this frame, at most the scheduler's published ceiling.
   *  Zero is the normal value of a still scene: a fixed light keeps its slice. */
  shadowsUpdated?: number | null;
  /**
   * GPU durations of the three direct-lighting passes, read by their label in the same
   * timestamp sample as `gpuPassMs`: per-tile light lists, shadow atlas, deferred resolve.
   * They therefore describe the frame of `gpuPassMs.frame`, not the current frame, and are `null` as
   * soon as the device exposes no timestamps, the sample was truncated, or the pass did not
   * run — a frame without a light launches neither lists nor shadows. Never added to a `cpu*`.
   */
  /** What the shadow pass redrew: faces (views) and draw calls actually encoded.
   *  This is the cost per shadow light, split from the rest. Null on an engine that draws no shadow. */
  shadowFacesDrawn?: number | null;
  shadowDrawCalls?: number | null;
  /** Cluster cuts run from the lights: one per redrawn face, zero on a still frame. */
  shadowLightCuts?: number | null;
  /** What page invalidation produced: pages redrawn by the frame, pages left in
   *  the queue for lack of budget, and the lag in milliseconds of the oldest of them. Zero
   *  everywhere is the normal value of a still scene; `null` on an engine without a shadow atlas. */
  shadowPagesDrawn?: number | null;
  /** Pages drawn since the explorer opened, drains of `flush()` included: what a change cost
   *  is the difference between two readings. */
  shadowPagesTotal?: number | null;
  shadowPagesPending?: number | null;
  shadowWaitMs?: number | null;
  gpuLightListsMs?: number | null;
  gpuShadowsMs?: number | null;
  gpuLightingMs?: number | null;
}
