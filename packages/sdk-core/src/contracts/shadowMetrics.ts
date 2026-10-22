import type { ReflectionFrameMetrics } from './reflectionMetrics.ts'

/**
 * The state of the bouncing light's probes, as the frame leaves them (`ShadowFrameMetrics.bounce`):
 * whether they exist, what they hold, and what their updates did. The GPU counts (`census*`, `*Total`
 * names) are read back a few images late and are `null` before the first reading; the others are the
 * CPU's, of the image just drawn.
 */
export interface BounceFrameMetrics {
  /** Whether the probes exist: the proxy was read and the passes built. */
  rigged: boolean
  /** Whether they are on their way: the proxy being read, no refusal yet. */
  loading: boolean
  /** Why there are no probes, when there are none. */
  unavailable: string | null
  /** The probes the pool holds at most. */
  probes: number | null
  /** Probes alive: a cell the image reads holds one. */
  liveProbes: number | null
  /** Probes alive that were never traced: zero says the light the image reads is filled. */
  unfilledProbes: number | null
  /** Marks refused for want of a probe in the pool, since it was made. */
  refusedMarks: number | null
  /** The marks that came back from the GPU, and the cells the last one named. */
  marksRead: number | null
  cellsMarked: number | null
  /** Probes queued to be traced by the last image, and the rays that makes. */
  probesUpdated: number
  rays: number
  /** The GPU duration of the bounce pass in the last image timed, in milliseconds: a measure, nothing
   *  steers by it. */
  passMs: number | null
  /** Whether the series is closed: nothing left to trace, to write or to mark. */
  converged: boolean | null
  /** Censuses of the field that came back from the GPU. */
  censusReads: number | null
  /** The entries of the table that name a probe, as the last census found them. */
  publishedSlots: number | null
  /** The probes of the pool that hold light, that hold none, that are buried, as the last census found them. */
  nonZeroProbes: number | null
  darkProbes: number | null
  buriedProbes: number | null
  /** Totals since the probes were made: probes whose update fired its rays, rays fired (every one
   *  answers: an exhausted ray as a hit), rays that brought light back; probes written, and written
   *  buried. */
  probesFiredTotal: number | null
  raysFired: number | null
  raysLit: number | null
  probesWrittenTotal: number | null
  probesBuriedTotal: number | null
  /** The rays that spent their budget, by what spent it: the ray's own work, its triangle tests, its
   *  walk of the placement tree, a mesh's walk; then the same four for its shadow ray (totals). An
   *  exhausted walk ends as a hit where it stopped, an exhausted shadow ray as a blocker. */
  raysExhaustedBy: number[] | null
  /** Every ray by the work it spent: under 64 units, 128, 256, 512, 1024, 2048, 4096, more (totals). */
  rayWork: number[] | null
  /** Rays that answered by meeting no surface, so that the sky answered them; shadow rays of the rays'
   *  hits that found nothing on their segment (the point is lit); those that found a surface (totals). */
  raysEscaped: number | null
  shadowRaysFree: number | null
  shadowRaysBlocked: number | null
  /** The work, in units, that the rays of the image the last census counted spent: all of it, and the part
   *  the placement tree's groups took (a ray that meets a group's box reads every member of it); the rest
   *  went to the tree's cells and the placements' cuts. One image, not a total. */
  imageRayWork: number | null
  imageRayMembers: number | null
  /** The furthest a probe's ray looks for a surface, in metres. */
  rayReach: number | null
  /** What the proxy the rays meet held at the last sync of the probes with the placements: the
   *  placements that wear a proxy (a parked placement does not), and the triangles of the meshes they
   *  wear, one count each. */
  proxyPlacements: number | null
  proxyTriangles: number | null
}

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
   *  of a scene of more lights than a list; `null` otherwise. */
  tileLightPoolReserved?: number | null
  /** Words the light-index pool held on that sampled frame; `null` likewise. */
  tileLightPoolCapacity?: number | null
  /** Whether a tile found no room in the pool on that sampled frame and walked every light. */
  tileLightPoolOverflowed?: boolean | null
  /** Times the pool grew to what an overflowing frame asked, since the explorer opened. */
  tileLightPoolGrowths?: number | null
  /** GPU time of the Shadows stage: every pass of the virtual shadow maps, and no other pass. */
  gpuShadowsMs?: number | null
  /** GPU time of lighting. */
  gpuLightingMs?: number | null
  /** The bouncing light's probes: whether they exist, what they hold, what their updates did. */
  bounce?: BounceFrameMetrics | null
  /** The reflections' rays of the last image counted: where each ended, how the proxy's walks ended
   *  and what they spent. `null` while the view makes no reflections. */
  reflections?: ReflectionFrameMetrics | null
}
