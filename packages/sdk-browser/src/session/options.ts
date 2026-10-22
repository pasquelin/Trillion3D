import type { AdmitGpuMemory } from './memory/activeMemory.ts'
import type {
  AssetScope,
  CameraPose,
  PreparationProgress,
} from '../../../sdk-core/src/contracts/base.ts'
import type { EngineDiagnostic, DiagnosticDetail } from '../diagnostic/types.ts'
import type { EngineFactory } from './engine/factory.ts'
import type { DiagnosticGpuVariant } from '../diagnostic/gpuVariant.ts'
import type {
  HlodWarmupOptions,
  WorldStreamingOptions,
} from '../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { CutOptions } from '../../../sdk-core/src/contracts/cutOptions.ts'
import type { DynamicResolutionOptions } from '../../../sdk-core/src/contracts/dynamicResolutionOptions.ts'
import type { AnimationOptions } from '../../../sdk-core/src/contracts/animationOptions.ts'
import type { ShadingOptions } from '../../../sdk-core/src/contracts/shadingOptions.ts'
import type { ExposureCurveOptions } from '../../../sdk-core/src/contracts/exposureCurve.ts'
import type { ExposureOptions } from '../../../sdk-core/src/contracts/exposureOptions.ts'
import type { TemporalOptions } from '../../../sdk-core/src/contracts/temporalOptions.ts'
import type { HizOptions } from '../../../sdk-core/src/contracts/hizOptions.ts'
import type { LightFunctionOptions } from '../../../sdk-core/src/contracts/lightFunctionOptions.ts'
import type { VolumetricLightmapOptions } from '../../../sdk-core/src/contracts/volumetricLightmapOptions.ts'
import type { DistanceFieldOcclusionOptions } from '../../../sdk-core/src/contracts/distanceFieldOcclusionOptions.ts'
import type { GlobalDistanceFieldOptions } from '../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'
import type { ShadowOptions } from '../../../sdk-core/src/contracts/shadowOptions.ts'
import type { MotionBlurSettings } from '../../../sdk-core/src/contracts/motionBlurOptions.ts'
import type { DepthOfFieldSettings } from '../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import type { BloomSettings } from '../../../sdk-core/src/contracts/bloomRules.ts'
import type { GaussianBlurSettings } from '../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import type { FilmSettings } from '../../../sdk-core/src/contracts/filmOptions.ts'
import type { AmbientOcclusionOptions } from '../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import type { SkyQualityOptions } from '../../../sdk-core/src/modules/sky/quality.ts'
import type { ScreenProbeOptions } from '../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { ReflectionOptions } from '../../../sdk-core/src/contracts/reflectionOptions.ts'
import type { VolumetricFogOptions } from '../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import type { TessellationOptions } from '../../../sdk-core/src/contracts/tessellationOptions.ts'
import type { RasterOptions } from '../../../sdk-core/src/contracts/rasterOptions.ts'
import type { StreamingOptions } from '../../../sdk-core/src/contracts/streamingOptions.ts'

/** A named view of a scene a page can jump to. */
export type PointOfInterest = {
  /** The view's short name, unique in its scene. */
  id: string
  /** The words a page shows for the view. */
  label: string
  /** Where the camera stands and what it looks at. */
  pose: CameraPose
}
/** A session's options. Beside those below, how the view streams a partitioned scene's cells
 *  (`worldStreaming…`) and the warm-up an HLOD switch waits on (`hlodWarmup…`), each setting by
 *  its field (`../../../sdk-core/src/contracts/worldStreamingOptions.ts`), its default left out;
 *  set during the session by `explorer.setWorldStreaming`, one field at a time. The cut's
 *  settings likewise (`cut…`, `../../../sdk-core/src/contracts/cutOptions.ts`), set during the
 *  session by `explorer.setCut` (among them the GPU time budget of the cut,
 *  `cutEdgeScaleBudgetMs`, and its lowest scale, `cutEdgeScaleMinPercent`), the dynamic
 *  resolution's heuristic's (`dynamicResolution…`,
 *  `../../../sdk-core/src/contracts/dynamicResolutionOptions.ts`), set by
 *  `explorer.setDynamicResolution`, the animation's (`animation…`,
 *  `../../../sdk-core/src/contracts/animationOptions.ts`), set by `explorer.setAnimation`, and the
 *  shading's (`shadeBinningMode`, `../../../sdk-core/src/contracts/shadingOptions.ts`), set by
 *  `explorer.setShading`, and the exposure's (`exposure…` and `localExposure…`,
 *  `../../../sdk-core/src/contracts/exposureOptions.ts`: bias, range, histogram, shares, speeds,
 *  transition, black bucket, luminance, then the local exposure's contrasts, detail, blur,
 *  middle grey and thresholds), set by `explorer.setExposure`, the exposure's compensation curve (`exposureCurve`,
 *  `../../../sdk-core/src/contracts/exposureCurve.ts`), set by `explorer.setExposureCurve`, and the temporal pass's
 *  (`temporalThinGeometry`, `../../../sdk-core/src/contracts/temporalOptions.ts`), set by
 *  `explorer.setTemporal`, and the sun's shadows' (`shadowDistanceScale`, 1: the factor on every
 *  sun's shadow distance, from 0 to 2; `farShadowCulling`, true: whether a sun's shadow maps leave
 *  out the casters past the edge of that distance; `farShadowCullsAllMeshes`, false: whether the
 *  test reaches every caster, not only the world's merged shells; and the three that shape its
 *  edge: `shadowNearLevels`, 10, from 0 to 10, capped by the light's four; `shadowOverlapScale`, 1,
 *  from 0 to 2; `shadowFarField`, true, `../../../sdk-core/src/contracts/shadowOptions.ts`) and the
 *  shadow maps' own (the clipmap's levels and depth range, the coarse pages, the resolution biases,
 *  the radius threshold, the rays and steps of a trace, the page pool: `shadowClipmap…`,
 *  `shadowMarkCoarsePages…`, `shadowResolutionLodBias…`, `shadowRadiusThreshold…`, `shadowRayCount…`,
 *  `shadowSamplesPerRay…`, `shadowMaxPhysicalPages`,
 *  `../../../sdk-core/src/contracts/shadowMapOptions.ts`), set by
 *  `explorer.setShadows`. The motion
 *  blur's drawing (`motionBlurQuality`, `'veryHigh'`;
 *  `motionBlurHalfResGather`, false; `motionBlurHalfResInput`, true; `motionBlurSeparable`, false;
 *  `motionBlurScatter`, false; `motionBlurDirections`, 1,
 *  `../../../sdk-core/src/contracts/motionBlurOptions.ts`), set by
 *  `explorer.setMotionBlur`. The depth of field's drawing (`depthOfFieldQuality`, `'on'`: `'off'` or `'on'`;
 *  `depthOfFieldRingCount`, 4; `depthOfFieldAccumulator`, `'high'`; `depthOfFieldTemporalQuality`, `'high'`; and the others of
 *  `../../../sdk-core/src/contracts/depthOfFieldRules.ts`), set by `explorer.setDepthOfField`. The bloom's drawing (`bloomQuality`, `'highest'`: `'off'`, `'lowest'`,
 *  `'low'`, `'medium'`, `'high'` or `'highest'`; `bloomCross`, 0; `bloomScreenPercentage`, 50;
 *  `bloomApplyLocalExposure`, true; `bloomCacheKernel`, true,
 *  `../../../sdk-core/src/contracts/bloomRules.ts`), set by `explorer.setBloom`. The Gaussian blur's
 *  (`gaussianFastBlurThreshold`, 100; `gaussianSampleScale`, 1; `gaussianLoopMode`, 0,
 *  `../../../sdk-core/src/contracts/gaussianBlurRules.ts`), set by `explorer.setGaussianBlur`. The film effects' (`filmGrain…`, `chromaticAberration…`,
 *  `vignette…`, `tonemapperQuality`, `tonemapperSharpen`, `sceneColorTint…`,
 *  `quantizationDitheringBits`, `../../../sdk-core/src/contracts/filmOptions.ts`), set by
 *  `explorer.setFilm`. The volumetric fog's quality (`volumetricFogQuality`, `'high'`: `'off'`,
 *  `'low'`, `'high'` or `'ultra'`) and its eleven other settings
 *  (`../../../sdk-core/src/contracts/volumetricFogOptions.ts`), set by `explorer.setVolumetricFog`;
 *  the volume exists only in a scene whose fog sets `volumetric`. The reflections' trace
 *  (`reflectionScreenSteps`, 50 and `reflectionRingSteps`, 256: the iterations of a reflected ray's march of the screen and
 *  the steps it takes in each ring of the scene; `reflectionMeshTraces`, true and `reflectionDetailSteps`, 64: its detail
 *  window; `reflectionDistantScreenTraces`, true, `reflectionDistantScreenSteps`, 16 and `reflectionDistantScreenDistance`,
 *  2000 m: the far screen trace, `../../../sdk-core/src/contracts/reflectionOptions.ts`), set by `explorer.setReflections`. The screen-space
 *  ambient occlusion's (`ambientOcclusion`, true; `ambientOcclusionIntensity`, 0.5; `ambientOcclusionRadius`, 2 m;
 *  `ambientOcclusionQuality`, 50; and the others of `../../../sdk-core/src/contracts/ambientOcclusionOptions.ts`),
 *  set by `explorer.setAmbientOcclusion`. The depth pyramid's (`hizTrace`, `hizFoldTransparents`,
 *  `hizTransparentTest`, `hizFullResDepth`, `lightGridHizCull`,
 *  and the five of the primed pyramid, `hizPrime` (`'off'`), `hizPrimeSizeBias`, `hizPrimeDepthBias`,
 *  `hizPrimeErrorScale` and `hizPrimeFarFieldOnly`,
 *  `../../../sdk-core/src/contracts/hizOptions.ts`),
 *  set by `explorer.setHiz`. The software raster (`softwareRaster`, on by default: a cluster whose
 *  longest edge projects under `hardwareRasterEdgePixels` and that crosses neither clip plane is
 *  rastered in compute, every other one by the hardware rasterizer; `false` draws every cluster
 *  with the hardware) and the edge it goes to the hardware at (`hardwareRasterEdgePixels`, 32 by
 *  default, a finite number above zero), `../../../sdk-core/src/contracts/rasterOptions.ts`, set by
 *  `explorer.setSoftwareRaster` and `explorer.setHardwareRasterEdgePixels`. The geometry
 *  streaming's nine settings (`streaming…`,
 *  `../../../sdk-core/src/contracts/streamingOptions.ts`): the pages kept started at once
 *  (`streamingMaxPendingPages`, 128), those a frame installs at most
 *  (`streamingMaxInstallsPerFrame`, 128, never more than may be pending), the pool's load in
 *  percent of its pages under which the quality rises again and over which it falls
 *  (`streamingQualityMinPoolPercent` 70, `streamingQualityMaxPoolPercent` 85, read no lower than
 *  the low mark, from 10 to 100), the lowest scale of the screen error it falls to
 *  (`streamingQualityMinScale`, 0.3, from 0.1 to 1), the times a failed read of a page is tried
 *  again before its page is given up (`streamingNumRetries`, 3, at once and with no wait but the
 *  one a server asks, a negative value without end), the least and the most requests the camera
 *  cut's readout holds (`streamingMinRequests`, 65 536, `streamingMaxRequests`, 1 048 576, from
 *  4 096 to 1 048 576, the most read no lower than the least: it starts at the least and follows
 *  what the cut asks of it) and the bandwidth the reads are simulated to have
 *  (`streamingBandwidthLimit`, in megabytes a second, -1 for none); set by
 *  `explorer.setStreaming`, from the streaming's next update. Each is refused at the opening when
 *  out of its range. */
export interface MeasuredWorldOptions
  extends
    WorldStreamingOptions,
    HlodWarmupOptions,
    CutOptions,
    DynamicResolutionOptions,
    AnimationOptions,
    ShadingOptions,
    ExposureOptions,
    ExposureCurveOptions,
    TemporalOptions,
    HizOptions,
    LightFunctionOptions,
    VolumetricLightmapOptions,
    GlobalDistanceFieldOptions,
    DistanceFieldOcclusionOptions,
    ShadowOptions,
    MotionBlurSettings,
    DepthOfFieldSettings,
    BloomSettings,
    GaussianBlurSettings,
    FilmSettings,
    VolumetricFogOptions,
    TessellationOptions,
    ScreenProbeOptions,
    ReflectionOptions,
    AmbientOcclusionOptions,
    SkyQualityOptions,
    RasterOptions,
    StreamingOptions {
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
  drawViews?: () => void
  /** Called after every frame the session draws, with that frame's metrics. */
  onFrame?: (metrics: import('../../../sdk-core/src/contracts/metrics.ts').FrameMetrics) => void
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
  /** Texture-tile bytes the WebGPU engine admits per frame; 16 MiB by default. */
  maxTextureTransferBytesPerFrame?: number
  /** CPU milliseconds the WebGPU engine may spend copying texture tiles per frame; 1.0 by
   *  default. The pass stops after the copy that crosses it; the tiles left wait for the next
   *  frame, shown meanwhile by their coarser resident level; the worst pass is published as
   *  `textureUploadPeakMs`. */
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
  /** Particle pools, held by the world (`attachParticles`). */
  particles?: readonly import('../../../sdk-core/src/fluids/particles.ts').ParticlePool[]
  /** Bounced light. On by default; `false` turns it off for the whole session. */
  bounce?: boolean
  /** Probes the bounce traces a frame, those never traced first: a whole count from 1 to 768,
   *  100 by default; a slow device lowers it. */
  bounceProbesPerFrame?: number
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
