import type { SettingOptions } from './settingOptions.ts'
import type { AdmitGpuMemory } from './memory/activeMemory.ts'
import type {
  AssetScope,
  CameraPose,
  PreparationProgress,
} from '../../../sdk-core/src/contracts/base.ts'
import type { EngineDiagnostic, DiagnosticDetail } from '../diagnostic/types.ts'
import type { EngineFactory } from './engine/factory.ts'
import type { DiagnosticGpuVariant } from '../diagnostic/gpuVariant.ts'

/** A named view of a scene a page can jump to. */
export type PointOfInterest = {
  /** The view's short name, unique in its scene. */
  id: string
  /** The words a page shows for the view. */
  label: string
  /** Where the camera stands and what it looks at. */
  pose: CameraPose
}
/** A session's options. Beside those below, each setting of the engine by its field, its default
 *  left out (`SettingOptions`, `./settingOptions.ts`): the fields, ranges and defaults of each group
 *  are stated by its contract file (`../../../sdk-core/src/contracts/`), and a group is set during
 *  the session by its `explorer.set…` setter. Each is refused at the opening when out of its range. */
export interface MeasuredWorldOptions extends SettingOptions {
  /** Own controls, CSS/DPR sizing and demand-driven rendering. Off by default. */
  interactive?: boolean
  /** Called before every frame the interactive session draws: the host writes its scene then. */
  beforeFrame?: () => void
  /** Asked once a partitioned scene's view outgrew the rows the open session can grow in place —
   *  its engine cannot grow them —: the cells past those rows wait, and the owner says it by name.
   *  Given, the rows are sized for the first view, not for every node. */
  onPartitionOutgrown?: () => void
  /** Asked when the session running cannot take content it was handed after its opening, in a
   *  step that ends after the hand-over (a cut the device refuses): `what` the content, `reason`
   *  the limit. The session goes on with the cut it runs; the owner says it by name. */
  onContentRefused?: (what: string, reason: string) => void
  /** Draws the views beside the main one, after each frame's main image (`world.addView`). */
  drawViews?: (refreshMs: number | null) => void
  /** Called after every frame the session draws, with that frame's metrics. */
  onFrame?: (metrics: import('../../../sdk-core/src/contracts/metrics.ts').FrameMetrics) => void
  /** The world's time, in seconds, read at each image: the sum of the seconds the world's clips and
   *  controllers integrated, a pause of the loop counted as one running interval, and what the
   *  automatic exposure adapts on and the `time` of a material graph reads — what the world did not
   *  live, a frame the loop slept through, they do not either. Set by the world that draws the
   *  session; absent, the engine runs on its own image clock (a bench or a test with no world). */
  worldClock?: () => number
  replicaCount?: 1 | 4 | 9 | 12
  detail?: 'source' | 'maximum'
  onEvent?: (event: import('../../../sdk-core/src/runtime/events.ts').RuntimeEvent) => void
  manifestUrl: string
  scope?: AssetScope
  signal?: AbortSignal
  width?: number
  height?: number
  fov?: number
  pixelRatio?: number
  pageFetchWorkers?: number
  maxPageTransferBytes?: number
  onPreparation?: (event: PreparationProgress) => void
  /** Measurement seam (`../measurement/measurement.ts`), never a host's: the engine's own
   *  factory (`webgpuPagesEngine`) or a test's stand-in, handed in so a bench page builds it
   *  without loading the renderer family. Absent, the session loads that family. */
  engine?: EngineFactory
  maxResidentPages?: number
  /** The decoded-page cache the session reads through, and the CPU total it counts against: the
   *  world's, kept across its sessions, so a session reopened fetches nothing it holds. Set by the
   *  world itself (its CPU total is `world.budget.cpu`); a session without one reads through a
   *  cache of its own. */
  pageCache?: import('../geometry/streaming/pageCache.ts').PageCache
  pixelError?: number
  /** Bounded diagnostics emitted by a backend and owned by the host report. */
  onDiagnostic?: (diagnostic: EngineDiagnostic) => void
  /** Summary suppresses per-frame trace records; trace is the default with an observer. */
  diagnosticDetail?: DiagnosticDetail
  preload?: 'visible' | 'all'
  gpu?: GPU
  /** A WebGPU device the caller holds: the session draws on it instead of requesting its own,
   *  and leaves it alive when disposed — what a world reopening its session keeps. */
  gpuDevice?: GPUDevice
  pointsOfInterest?: PointOfInterest[]
  /** Texture-tile bytes the WebGPU engine admits per frame, besides the cap of 32 tiles a frame;
   *  16 MiB by default. */
  maxTextureTransferBytesPerFrame?: number
  /** CPU milliseconds the WebGPU engine may spend copying texture tiles per frame, besides the cap
   *  of 32 tiles a frame; 1.0 by default. The pass stops after the copy that crosses it; the
   *  tiles left wait for the next frame, shown meanwhile by their coarser resident level; the
   *  worst pass is published as `textureUploadPeakMs`. */
  maxTextureUploadMsPerFrame?: number
  /** Geometry-page pool bytes — streamed geometry memory, regardless of the scene, a fixed
   *  512 MB pool. 512 MiB by default.
   *  The root cover is held beside it, never in it; what a view asks beyond the pool draws
   *  coarser, never refused. Set during the session by `explorer.setMemoryBudgets`. */
  geometryPoolBytes?: number
  /** Internal transaction against the owning world's declared global GPU budget. */
  admitGpuMemory?: AdmitGpuMemory
  /** Virtual-texture pool bytes of the WebGPU engine — texture memory, regardless of the
   *  scene. 512 MiB by default, split equally between the colour atlas and the data atlas,
   *  in 64 MiB layers; under one layer per atlas the pool is raised to one, by name. What
   *  a view asks beyond that waits for a less-looked-at tile to free, and a missing tile
   *  shows its coarse level: the `textureTiles*` metrics publish it. Set during the session
   *  by `explorer.setMemoryBudgets`. */
  texturePoolBytes?: number
  /** Block compression of the WebGPU texture pools. `'auto'`, the default, takes the format
   *  the device samples among those the cache bakes — BC7 on desktop cards, ASTC 4×4 or ETC2
   *  on mobile ones —, one byte per texel in the pool instead of four, the same budget holding
   *  four times the tiles; `'bc7'`, `'astc'` or `'etc2'` insist on one, `'none'` keeps RGBA8, the
   *  lossless "before" of a comparison. Only a texture whose chain the cache baked and kept in
   *  that family reads blocks; a texture with no baked chain, a chain the gate refused or a
   *  cache cooked without the family stays RGBA8 in the lossless lane. */
  textureCompression?: import('../materials/texture/blockFormats.ts').TextureCompression
  /** Temporal antialiasing of the WebGPU engine, on by default: each
   *  frame is rendered with a fraction-of-a-pixel jitter and accumulated over the previous
   *  ones, reprojected. `false` renders the image sampled at the pixel centre, with no
   *  history — that is the "before" of a comparison, and what pixel-for-pixel benches ask; `'off'`
   *  the same. A level (`TEMPORAL_AA_LEVELS`) sets its quality, `true` the default one. */
  temporalAntialiasing?:
    boolean | import('../../../sdk-core/src/contracts/compilerAbi.ts').TemporalAntialiasingLevel
  /** The frame's render scale (`../frame/scale/renderScaleOption.ts`): the fraction of the display
   *  per axis it is drawn at, reconstructed to it by temporal antialiasing, fixed or `'auto'`, chosen by the frame budget. 1 by default: the frame is drawn at the display. */
  renderScale?: import('../frame/scale/renderScaleOption.ts').RenderScale
  /** The loop's frame cap, frames a second (`../frame/cadence.ts`); none by default. */
  maxFrameRate?: number
  /** Reference mode (`../frame/reference/referenceMode.ts`): every approximation it names off, the frame
   *  supersampled and `capture` resolved to the display; what a rendering technique is held to.
   *  Off by default. */
  reference?: boolean
  /** The world's effect chain, drawn after temporal antialiasing (`world.effects`). */
  effects?: import('../../../sdk-core/src/world/effect/chain.ts').EffectChain
  /** Lines and points drawn over the image, held by the world (`world.guides`). */
  guides?: import('../guides/guideSet.ts').GuideSet
  /** Particle pools, held by the world (`world.particles`). */
  particles?: readonly import('../../../sdk-core/src/fluids/particles.ts').ParticlePool[]
  /** Bounced light. On by default; `false` turns it off for the whole session. */
  bounce?: boolean
  /** Time every step of the frame and publish `explorer.stageProfile()`. Off by default. */
  stageProfile?: boolean
  /** Opt-in same-session GPU feedback-target A/B diagnostic; never enabled by production. */
  feedbackTargetAB?: boolean
  /** Keep drawing a still view whose temporal history is whole instead of holding its converged
   *  image: every frame then costs a full draw, what a cost measurement reads. Off by default. */
  drawConverged?: boolean
  /** A GPU DIAGNOSTIC variant (`../diagnostic/gpuVariant.ts`): it neutralises a factor of the
   *  frame to split its duration, and therefore renders an image different from production.
   *  Absent by default; refused outside `diagnosticDetail: 'trace'`. */
  diagnosticGpuVariant?: DiagnosticGpuVariant
  /** Declare the lights the source file carried, read from the cache. On by default: an
   *  imported scene arrives with its lights. `false` opens the scene with none of them. */
  importedLights?: boolean
  logInterval?: number
}
