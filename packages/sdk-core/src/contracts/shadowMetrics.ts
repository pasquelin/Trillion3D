import type { ScreenProbeLevel } from '../bounce/screenProbeLevels.ts'
import type { AmbientOcclusionMethod } from './ambientOcclusionHorizon.ts'
import type { ReflectionFrameMetrics } from './reflectionMetrics.ts'
import type { SurfaceCacheFrameMetrics } from './surfaceCacheMetrics.ts'

/**
 * The screen-space ambient occlusion of the last image (`ShadowFrameMetrics.ambientOcclusion`): the method it ran, whether the
 * image drew it, the bytes its textures hold, and, where the device's memory budget kept a view from being made, the reason.
 */
export interface AmbientOcclusionFrameMetrics {
  method: AmbientOcclusionMethod
  drawn: boolean
  bytes: number
  why: string | null
}

/**
 * The tone table of the last image (`ShadowFrameMetrics.toneTable`): the texels a side of the cube the colour is baked into, the
 * bytes it holds and, where the device's memory budget kept it from the size the setting asks, the reason.
 */
export interface ToneTableFrameMetrics {
  side: number
  bytes: number
  why: string | null
}

/**
 * The screen probes of the last image (`BounceFrameMetrics.screen`), the CPU's: the level they ran at, the
 * tile a probe stands for, the probes the atlas holds, the rays an image casts, the history they read and
 * what they weigh. The adaptive probes placed this image are a count the GPU makes: the capacity is the most
 * it may.
 */
export interface ScreenProbeFrameMetrics {
  /** The level the probes ran at (`'off'` casts none). */
  level: ScreenProbeLevel
  /** Pixels along a probe's tile. */
  tile: number
  /** The uniform probes of the image, and the most adaptive ones its atlas holds. */
  uniformProbes: number
  adaptiveCapacity: number
  /** Rays a side of a probe's octahedron, and the most rays the image casts through the screen stage: the uniform
   *  probes' and the adaptive ones' at most (the adaptive probes placed are a count the GPU makes). */
  tracingResolution: number
  raysPerImage: number
  /** Rows and columns of probes of the atlas. */
  atlas: [number, number]
  /** Whether the image's pixels read a history, whether its probes traced the screen, whether their rays were
   *  traced against the scene (and its detail), and whether the surfaces' vectors of the last image moved
   *  the history. */
  history: boolean
  screenTraces: boolean
  sceneTraces: boolean
  meshTraces: boolean
  velocity: boolean
  /** Bytes the view's screen probes hold. */
  bytes: number
  /** Whether the rays past the screen and the near scene read the radiance cache (the maps of the light by direction in the
   *  world's probes), the texels a side of its maps, and the bytes it holds: none of them where it is not read. */
  radianceCache: boolean
  radianceCacheResolution: number
  radianceCacheBytes: number
  /** Why the screen probes did not run this image, when they did not. */
  unavailable: string | null
}

/**
 * The state of the bouncing light's probes, as the frame leaves them (`ShadowFrameMetrics.bounce`):
 * whether they exist, what they hold, and what their traces did. All of them are the CPU's, of the image just drawn.
 */
export interface BounceFrameMetrics {
  /** Whether the probes exist: the scene's placements were read and the passes built. */
  rigged: boolean
  /** Whether they are on their way: being made, no refusal yet. */
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
  /** The pool's statistics that came back from the GPU (a few images late), and the cells the last one's image marked. */
  marksRead: number | null
  cellsMarked: number | null
  /** Probes queued to be traced by the last image. */
  probesUpdated: number
  /** The GPU duration of the bounce pass in the last image timed, in milliseconds: a measure, nothing
   *  steers by it. */
  passMs: number | null
  /** Whether the series is closed: nothing left to trace or to mark. */
  converged: boolean | null
  /** The furthest a probe's ray looks for a surface, in metres. */
  rayReach: number | null
  /** The placements that held a box at the last sync of the probes with them (a parked placement holds none). */
  placements: number | null
  /** The screen probes of the last image: the pixels' indirect light (`screenProbeOptions.ts`); none while
   *  none ran. */
  screen?: ScreenProbeFrameMetrics
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
  /** Placement worlds noted moved since the session began, a running total: its change per image is
   *  the placements a move reached. */
  shadowVsmRootsNoted?: number | null
  /** Root boxes the roots pass derived since the session began, a running total: the placements the
   *  diff of the instances' boxes can see change. */
  shadowVsmRootsBoxed?: number | null
  /** Projection passes this frame: the suns' and the local lights'. */
  shadowVsmProjectionPasses?: number | null
  /** The overflows the shadows saw in the last 10 seconds, one bit a kind: 1 the non-cluster marking's job queue,
   *  2 the one-pass projection's lights past its mask, 4 the page pool, 8 the casters' list past its room. 0 when
   *  none, or when `shadowAllowScreenOverflowMessages` is false. */
  shadowVsmOverflowFlags?: number | null
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
  /** Whether a column found no room left in the pool on that sampled frame and dropped the lights
   *  past it (`lightGridMaxCulledLightsPerCell`). */
  tileLightPoolOverflowed?: boolean | null
  /** GPU time of the Shadows stage: every pass of the virtual shadow maps, and no other pass. */
  gpuShadowsMs?: number | null
  /** GPU time of lighting. */
  gpuLightingMs?: number | null
  /** The bouncing light's probes: whether they exist, what they hold, what their updates did. */
  bounce?: BounceFrameMetrics | null
  /** The reflections' rays of the last image counted: where each ended, how their marches through the
   *  global distance field ended and the steps they took. `null` while the view makes no reflections. */
  reflections?: ReflectionFrameMetrics | null
  /** The surface cache of the last image: its atlas's fill, the pages it captured, why it is off. `null` while it is not made. */
  surfaceCache?: SurfaceCacheFrameMetrics | null
  /** The screen-space ambient occlusion of the last image. `null` while the view holds none. */
  ambientOcclusion?: AmbientOcclusionFrameMetrics | null
  /** The cube the colour grading bakes the display's colours into. `null` while the view holds none. */
  toneTable?: ToneTableFrameMetrics | null
}
