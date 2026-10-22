import type { MeasuredWorldOptions } from '../options.ts'
import type { WorldControls } from './camera.ts'
import type { WorldPhysicsOptions } from '../../physics/worldPhysicsOptions.ts'
import type { RenderScale } from '../../frame/scale/renderScaleOption.ts'
import type { WorldQualityOptions } from './quality.ts'
import type {
  HlodWarmupOptions,
  WorldStreamingOptions,
} from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type { CutOptions } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import type { AnimationOptions } from '../../../../sdk-core/src/contracts/animationOptions.ts'
import type { ShadingOptions } from '../../../../sdk-core/src/contracts/shadingOptions.ts'
import type { ExposureOptions } from '../../../../sdk-core/src/contracts/exposureOptions.ts'
import type { TemporalOptions } from '../../../../sdk-core/src/contracts/temporalOptions.ts'
import type { HizOptions } from '../../../../sdk-core/src/contracts/hizOptions.ts'
import type { RasterOptions } from '../../../../sdk-core/src/contracts/rasterOptions.ts'
import type { StreamingOptions } from '../../../../sdk-core/src/contracts/streamingOptions.ts'

/** What a page may set when it creates a world; saying nothing is the normal case. Beside the
 *  options below, how the view streams a partitioned scene's cells and the warm-up an HLOD switch
 *  waits on, each setting by its field with the reference's default
 *  (`../../../../sdk-core/src/contracts/worldStreamingOptions.ts`): `worldStreamingMaxLoadingCells`
 *  (4), `worldStreamingAngleWeight` (0.4), `worldStreamingSortByExtent` (true),
 *  `worldStreamingSortByPriority` (true), `worldStreamingUseGridRange` (true),
 *  `worldStreamingRangeScale` (1), `worldStreamingRadius` (100 m), `worldStreamingSector` (false),
 *  `worldStreamingSectorAngle` (360°), `worldStreamingZCulling` (false),
 *  `worldStreamingBlockOnSlowStreaming` (true),
 *  `worldStreamingBlockOnSlowStreamingRatio` (0.25), `hlodEnabled` (true), `hlodWarmup` (true),
 *  `hlodWarmupFrames` (5),
 *  `hlodWarmupGeometry` (true), `hlodWarmupTextures` (true), `hlodWarmupTextureScale` (2),
 *  `hlodWarmupTextureClamp` (2048).
 *  Named here, each holds over the quality preset; changed later by `world.worldStreaming`, from
 *  the next frame. The cut's settings likewise, each by its field with the reference's default
 *  (`../../../../sdk-core/src/contracts/cutOptions.ts`): `cutTwoPassOcclusion` (true),
 *  `cutOcclusionCulling` (true), `cutFrustumCulling` (true), `cutMinLodCulling` (true),
 *  `cutLodBiasFollowsUpscale` (true), `cutLodBiasOffset` (0), `cutLodBiasMin` (-2),
 *  `cutMaxNodes` (2097152), `cutMaxCandidateClusters` (16777216), `cutMaxVisibleClusters`
 *  (4194304); changed later by `world.cut`. The animation's settings likewise
 *  (`../../../../sdk-core/src/contracts/animationOptions.ts`): `animationMinScreenSize` (0.1),
 *  `animationBankInterpolation` (true), `animationBankTimeScale` (1); changed later by
 *  `world.animation`. The shading's likewise
 *  (`../../../../sdk-core/src/contracts/shadingOptions.ts`): `shadeBinningMode` (`'auto'`, or
 *  `'pixel'`, `'quad'`); changed later by `world.shading`. The automatic exposure's likewise
 *  (`../../../../sdk-core/src/contracts/exposureOptions.ts`), used where `world.exposure` is
 *  `'auto'`, the default: `exposureBias` (+1 stop), `exposureMinBrightness` (−10) and
 *  `exposureMaxBrightness` (+20) in EV100, `exposureHistogramLogMin` (−10) and
 *  `exposureHistogramLogMax` (+20) in stops of luminance, `exposureLowPercent` (10) and
 *  `exposureHighPercent` (90), `exposureSpeedUp` (3) and `exposureSpeedDown` (1) in stops a
 *  second, `exposureTransitionDistance` (1.5 stops), `exposureBlackBucketWeight` (0) and
 *  `exposureLuminanceMethod` (`'uniform'`, or `'ntsc'`, `'workingSpace'`), and the local
 *  exposure's `localExposureHighlightContrast` and `localExposureShadowContrast` (0.8),
 *  `localExposureDetailStrength` (1), `localExposureBlurBlend` (0.6), `localExposureBlurSize`
 *  (50 %), `localExposureMiddleGreyBias` (0) and the two thresholds and their strengths, which
 *  apply to a lit view whatever its exposure; changed later by `world.exposureSettings`. The
 *  temporal pass's likewise (`../../../../sdk-core/src/contracts/temporalOptions.ts`):
 *  `temporalThinGeometry` (false) — whether it looks for geometry thinner than a pixel and relaxes
 *  its history there, at any level but `'off'`; changed later by `world.temporal`. The depth
 *  pyramid's likewise (`../../../../sdk-core/src/contracts/hizOptions.ts`): `hizTrace`
 *  (`'reference'`, or `'planes'`) — how the reflections' trace reads it —, `hizFoldTransparents`
 *  (false) — whether its trace layers hold the transparent surfaces — and `hizTransparentTest`
 *  (`'finer'`, or `'reference'`) — how the transparent clusters are tested against it; changed
 *  later by `world.hiz`. The cluster
 *  raster's split likewise
 *  (`../../../../sdk-core/src/contracts/rasterOptions.ts`): `softwareRaster` (true) — a cluster
 *  whose longest edge projects under `hardwareRasterEdgePixels` and whose box crosses neither clip
 *  plane is rastered in compute, every other one by the hardware rasterizer; `false` hands every
 *  cluster to the hardware — and `hardwareRasterEdgePixels` (32, in pixels: a finite number above
 *  zero), the edge from which a cluster, seen at the nearest point of its level-of-detail sphere,
 *  goes to the hardware rasterizer; changed later by `world.softwareRaster` and
 *  `world.hardwareRasterEdgePixels`. The geometry streaming's likewise
 *  (`../../../../sdk-core/src/contracts/streamingOptions.ts`): `streamingMaxPendingPages` (128, the
 *  geometry pages kept started at once, a whole number from 1), `streamingMaxInstallsPerFrame`
 *  (128, the pages a frame installs at most, never more than may be pending),
 *  `streamingQualityMinPoolPercent` (70) and `streamingQualityMaxPoolPercent` (85, read no lower
 *  than the low mark) — the pool's load, in percent of its pages, under which the quality rises
 *  again and over which it falls, from 10 to 100 —, `streamingQualityMinScale` (0.3, from 0.1
 *  to 1, 1 never scales), `streamingNumRetries` (3, the times a failed read of a page is tried
 *  again before its page is given up, a negative value without end) and `streamingMinRequests`
 *  (65 536) and `streamingMaxRequests` (1 048 576), the least and the most requests the camera
 *  cut's readout holds, from 4 096 to 1 048 576 — it starts at the least and follows what the cut
 *  asks of it, the most read no lower than the least. A value a setting does not take is
 *  refused. */
export interface WorldOptions
  extends
    WorldStreamingOptions,
    HlodWarmupOptions,
    CutOptions,
    AnimationOptions,
    ShadingOptions,
    ExposureOptions,
    TemporalOptions,
    HizOptions,
    RasterOptions,
    StreamingOptions {
  /**
   * Whether the world runs its own loop: it draws when something changes and rests after 120
   * frames with nothing new. `false` lets the page call `world.render()` itself.
   * @defaultValue true
   */
  interactive?: boolean
  /** How many image pixels per screen pixel. @defaultValue the screen's own density */
  pixelRatio?: number
  /** The controller that moves the camera from the canvas; `world.controls.kind` changes it later.
   *  `'vehicle'` throws `NO_VEHICLE` here: no vehicle is set before the world exists — set
   *  `world.controls.vehicle`, then `kind`. @defaultValue 'none' */
  controls?: WorldControls
  /** Stops the world's loads when the signal is aborted. */
  signal?: AbortSignal
  /** Turns the physics on (`world.physics`): `true`, or gravity and budgets. Jolt is fetched only
   *  then. @defaultValue false */
  physics?: boolean | WorldPhysicsOptions
  /** Temporal antialiasing: sub-pixel jitter accumulated over frames, at a quality level —
   *  `'off'`, `'low'`, `'medium'`, `'high'`, `'max'` —, `true` the default level. `false` or
   *  `'off'` draws each pixel at its centre, with no history, what a pixel-exact capture asks.
   *  Named here, it holds over the quality preset and a scene's level; switched later by
   *  `world.temporalAntialiasing`. @defaultValue none: the preset's level, else the first loaded
   *  scene's, else `'max'` */
  temporalAntialiasing?: import('../../../../sdk-core/src/contracts/materialOptions.ts').TemporalAntialiasingOption
  /** The fraction of the display per axis the image is drawn at, before temporal antialiasing
   *  rebuilds it to the display: `'auto'` lets the frame budget choose it between `min` and `max`
   *  (`{ min, max }`, 0.5 and the display's default by default — 0.5 on a 3840×2160
   *  drawing buffer, 1 on a 720-tall one, `displayResolutionFraction`), a number fixes it, 1 the
   *  display's own size. A still image is drawn at that
   *  scale too, the budget's, and held once whole cycles of its jitter phases are averaged.
   *  Changed later by `world.renderScale`. @defaultValue 'auto' */
  renderScale?: RenderScale
  /** The most frames a second the world draws, even while its scene moves: a frame is drawn on a
   *  whole number of display refreshes, the fastest such rate at or under it (12 on a 60 Hz
   *  display: one refresh in five), each image shown for the same time; the ticks between draw
   *  and count nothing. A page of several worlds caps those out of focus. Changed later by
   *  `world.maxFrameRate`. @defaultValue Infinity, the display's rate */
  maxFrameRate?: number
  /** The quality: a preset, groups at levels of their own, the resolution (`world.quality`).
   *  @defaultValue every group at `'max'`, today's defaults; the native resolution, dynamic */
  quality?: WorldQualityOptions
  /** Debug mode, a development build's tools against a shipping build: the frames are filed
   *  into the CPU step profile (`world.cpuSteps`) and the frame report only in it. It is the
   *  page's, as `?profile` in its address turns it on; `world.diagnostic.debug` switches it later.
   *  @defaultValue false */
  debug?: boolean
}

/**
 * The options of every session a world opens: what the page set at creation, and what the world
 * holds at the moment — its device, its settings, its hooks. No imported light and no controller
 * of the session's own: a model's lights are nodes of the scene (`LoadedModel.lights`) and the
 * camera's controller is the world's, both written by the world itself.
 */
export const sessionOptions = (
  options: WorldOptions,
  held: Partial<MeasuredWorldOptions>,
): MeasuredWorldOptions => ({
  manifestUrl: '',
  interactive: options.interactive !== false,
  // Unset, the screen's density, followed as it changes whoever leads (`canvasFollower`).
  pixelRatio: options.pixelRatio,
  signal: options.signal,
  importedLights: false,
  ...held,
})
