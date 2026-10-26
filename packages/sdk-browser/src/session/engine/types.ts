import type { SettingOptions } from '../settingOptions.ts'
import type { AdmitGpuMemory } from '../memory/activeMemory.ts'
import type { TemporalAntialiasingLevel } from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import type { ViewCamera } from '../../camera/world.ts'
import type {
  EngineCapabilities,
  ViewFrameMetrics,
} from '../../../../sdk-core/src/contracts/metrics.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import type { DiagnosticMode } from '../../../../sdk-core/src/runtime/diagnostics.ts'
import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import type { MeshCards } from '../../../../sdk-core/src/lighting/meshCardsFile.ts'
import type { VolumetricLightmapData } from '../../../../sdk-core/src/lighting/volumetricLightmapFile.ts'
import type { ReadLightmap } from '../../lighting/volumetricLightmap/fileLoad.ts'
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import type { SceneFogVolumeStore } from '../../../../sdk-core/src/scene/volume/store.ts'
import type { SceneLocalFogStore } from '../../../../sdk-core/src/scene/localFog/store.ts'
import type { StageProfile } from '../../../../sdk-core/src/runtime/stageProfile.ts'
import type { EngineDrawCounters, EngineMetrics } from '../../diagnostic/metricKeys.ts'
import type { MemoryBudgets, MemoryBudgetsReport } from '../memory/pools.ts'
import type { CpuStepSummary, CpuStepWindow } from '../../diagnostic/stage/profiler.ts'
import type { HostCpuStep } from '../host/cpuProfile.ts'
import type { EngineDiagnostic, DiagnosticDetail } from '../../diagnostic/types.ts'
import type { DrawSource } from '../../geometry/selection/drawSource.ts'
import type { StreamPage } from '../../geometry/streaming/types.ts'
import type { EngineSceneUpdates } from '../../placement/engineSceneUpdates.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { EngineProbes } from './probes.ts'
import type { ResolvedSky } from '../../../../sdk-core/src/modules/sky/descriptor.ts'
import type { Ray } from '../../../../sdk-core/src/world/math/volumes.ts'
import type { Intersection, RayFilter, RayReach } from '../../api/query/types.ts'
import type { PresentRect } from '../../gpu/core/presentAt.ts'
import type { RenderScale } from '../../frame/scale/renderScaleOption.ts'
import type { WebgpuViewOptions } from '../../frame/backend/state/persistentView.ts'
import type { TextureCaches } from '../../materials/texture/textureCaches.ts'
import type { HdrViewsJob } from '../../frame/io/hdrCapture.ts'
type ViewSize = { width: number; height: number }
/** A view drawn beside the main one (`Engine.addView`). */
export interface EngineView {
  /** Draws the view from `camera`, after the frame's main image; `index` names it in its
   *  metrics. */
  render(camera: ViewCamera, index: number): ViewFrameMetrics
  /** Its drawing buffer's size, canvas pixels; or its rectangle of the main canvas. */
  resize(width: number, height: number, rect?: PresentRect): void
  setRenderScale(scale: RenderScale | undefined): void
  setTemporalAntialiasing(level: TemporalAntialiasingLevel): void
  /** Leaves, its GPU resources released once the device answered what it asked. */
  release(): Promise<void>
}
/** The engine: the WebGPU page raster (`../../frame/backend/pages.ts`), the session's one renderer.
 *  Every member is its own and required; a test's stand-in casts a partial one. */
export interface Engine extends EngineSceneUpdates, EngineProbes {
  id: string
  capabilities: EngineCapabilities
  setDiagnostic(mode: DiagnosticMode): void
  /** Holds the main view's cut at the camera it has now, or follows the camera again
   *  (`world.diagnostic.freeze`, `../../frame/render/cutFreeze.ts`). */
  freezeCut(frozen: boolean): void
  /** The contract light store has changed: the next frame will reread it. */
  refreshSceneLights(): void
  /** The store of the objects voxelised into the fog's volume, or the one of the local fog volumes, has changed: the
   *  next frame will read it. */
  refreshFogVolumes(): void
  /** The sky module's resolved parts for the engine to draw — the sky light's capture, the clouds
   *  with their shadow maps; `undefined` when the module is off, which releases what an earlier word
   *  made. Takes effect at the next frame. */
  applySky(sky: ResolvedSky | undefined): void
  /** Extra lighting facts: shadow support and a reason when absent. */
  lighting: { shadows: boolean; reason?: string }
  /** Sets memory pools during the session; returns what the engine holds afterwards. */
  setMemoryBudgets(budgets: MemoryBudgets): Promise<MemoryBudgetsReport>
  signal: AbortSignal // Aborted by its dispose or its session's: `prepare` then fails as cancelled.
  prepare(): Promise<void>
  render(camera: ViewCamera): void
  /** A view drawn beside the main one, from a camera of its own, into a canvas of its own or at a
   *  rectangle of the main one's (`../../frame/backend/state/persistentView.ts`). */
  addView(options: WebgpuViewOptions): Promise<EngineView>
  readonly overBudget: boolean
  /** Canvas the engine presented its image into when the host handed it none (`gpuCanvas`): a
   *  host composing elsewhere copies it. `undefined` when the engine draws on the host canvas, and
   *  withdrawn — canvas blanked — by a lost or disposed device before the next call raises
   *  `WEBGPU_LOST`: no host composes a frame older than the device. */
  readonly presentedSurface: HTMLCanvasElement | undefined
  /** The host sized the canvas the engine presents into, which blanks it: the next frame presents
   *  its image even when held. */
  canvasResized(): void
  metrics(): EngineMetrics & EngineDrawCounters
  /** Per-step profile of the sliding window: CPU and GPU durations kept separate; `enabled:
   *  false` when the host did not ask. */
  stageProfile(): StageProfile
  /** Forgets the profile window: warmup and the first frames no longer weigh on its quantiles. */
  resetStageProfile(): void
  /** CPU bounds of the images since that reset, read once then forgotten; `null` with no row. */
  cpuSteps(): CpuStepSummary | null
  /** A CPU step window of the caller's own, over the images filed from now on: reading it never
   *  moves `cpuSteps`'s window, nor another reader's. */
  openCpuSteps(): CpuStepWindow
  /** A bound the host recorded itself — outside the frame it would have lengthened —, slotted in
   *  the engine's own bound table. */
  cpuStep(step: HostCpuStep, ms: number): void
  /** The host's share of the frame ended: the bounds it just sampled belong to this frame. */
  cpuFrameEnd(): void
  /** The frame's CPU time, the number the stats corner shows (`FrameMetrics.cpuFrameMs`). */
  frameCpuMs(ms: number): void
  /** What the transparent occlusion test rejected, and the depth it rejected against: the proof
   *  that no removed cluster would have written a pixel. */
  transparentOcclusionAudit(): Promise<
    import('../../blend/transparent/occlusionAudit.ts').TransparentOcclusionAudit | null
  >
  /** The pages the last cut asked for and the session holds no bytes of. */
  pendingUrls(): string[]
  /** Page pins as a difference of request ranks: what entered and left since the last image. */
  retainedRanks(): import('../../geometry/streaming/types.ts').HostRetentionDelta
  /** The catalogue integer sheet for a request: what off-thread integration plans. */
  pageSpecs(url: string): Int32Array | undefined
  acceptPage(
    url: string,
    array: Uint32Array,
    plan?: import('../../geometry/integration/host.ts').ArrivalPlan,
  ): void
  dropPage(url: string): void
  /** Bytes of the cut's host tables now — the GPU cut publication's host mirrors, sized by the
   *  view and the pool: the CPU total holds them beside the pages the streamer caches
   *  (`../memory/memoryBudget.ts`). */
  hostTableBytes(): number
  syncResident(): void
  flush(options?: { image?: boolean }): Promise<void> // image: false skips the readback
  /** Wait for submitted work without image readback: the frame's feedback, consumed in order by
   *  the interactive loop, which draws every frame whatever it answers (`frameScheduler.ts`). */
  pendingFrame(): Promise<boolean>
  /** The interactive loop's frame began: true where the engine holds it, drawing nothing, to
   *  measure the display (`../../frame/loop/interactiveFrame.ts`); an explicit render never is. */
  measureFrame(): boolean
  /** The interactive loop's display frame began: true where the engine leaves it out under its
   *  frame cap (`../../frame/cadence.ts`) — nothing drawn, no frame counted; an explicit render never
   *  is. */
  skipsFrame(): boolean
  /** Whether the session still runs its initial load: its first image not shown yet
   *  (`../../frame/loop/firstImage.ts`). Meanwhile a partition holds no cell back from loading. */
  initialLoad(): boolean
  /** A partition's load blocks on slow streaming (`blocked`), or blocks no more
   *  (`../../geometry/partition/slowStreaming.ts`): meanwhile no image is presented
   *  (`../../frame/loop/firstImage.ts`). Told only as it moves. */
  streamingBlocks(blocked: boolean): void
  /** The nearest drawn triangle a world ray meets — or line it passes within `lineReach` of —, of
   *  the objects `filter` lets it meet, within `reach` (`../../lighting/rays/rayQueue.ts`): traced on
   *  the GPU at the next tick with every ray cast meanwhile, answered a frame or so later, never
   *  waited for. A session that cannot trace — opening, lost, disposed — answers `null`. */
  castRay(ray: Ray, filter?: RayFilter, bounds?: RayReach): Promise<Intersection | null>
  /** Current GPU image, bottom-left origin, read back without stalling a frame: the one the last
   *  flush read when it is still current. */
  capture(): Promise<Uint8Array>
  /** The composed image of `camera` at a size of its own, drawn aside: nothing is presented. */
  captureColorView(camera: ViewCamera, size: ViewSize): Promise<Uint8Array>
  /** The lit linear HDR image of each camera of the job, drawn aside with its overrides and taken
   *  away by its copy: nothing is presented (`../../frame/io/hdrCapture.ts`). */
  captureHdrViews(job: HdrViewsJob): Promise<void>
  captureSurfaceView(
    camera: ViewCamera,
    options: { width: number; height: number; signal?: AbortSignal },
  ): Promise<import('../../materials/surface/surfaceBuffer.ts').SurfaceCapture>
  dispose(): void | Promise<void> // A release that finishes later resolves when it has.
}
/** What an engine is built on. Beside the fields below, how the view streams a partitioned scene's
 *  cells and the warm-up an HLOD switch waits on, each setting by its field
 *  (`../../../../sdk-core/src/contracts/worldStreamingOptions.ts`), resolved at the opening,
 *  written by `setWorldStreaming`, read through their resolvers at each frame by the partition
 *  (`../../frame/schedule/sessionFrame.ts`) and the HLOD warm-up (`../../frame/prepare/hlodWarm.ts`);
 *  the cut's settings likewise (`../../../../sdk-core/src/contracts/cutOptions.ts`), written by
 *  `setCut`, read at each frame by the cut (`../../frame/render/gpuCut.ts`); the animation's
 *  likewise (`../../../../sdk-core/src/contracts/animationOptions.ts`), written by `setAnimation`,
 *  read at each frame by the animation banks' tracks (`../../deformation/bankTracks.ts`); the
 *  shading's likewise (`../../../../sdk-core/src/contracts/shadingOptions.ts`), written by
 *  `setShading`, read at each frame by the material pass (`../../materials/classes/materialPasses.ts`);
 *  the exposure's, the automatic one's and the local one's
 *  (`../../../../sdk-core/src/contracts/exposureOptions.ts`), written by `setExposure`, and
 *  its compensation curve (`exposureCurve`), written by `setExposureCurve`, read at
 *  each frame by the meter (`../../post/exposure/frame.ts`) and the local exposure
 *  (`../../post/finish/frame.ts`); the temporal pass's
 *  (`../../../../sdk-core/src/contracts/temporalOptions.ts`), written by `setTemporal`, read at
 *  each image by the pass (`../../post/taa/frame.ts`); the sun's shadows'
 *  (`../../../../sdk-core/src/contracts/shadowOptions.ts`), written by `setShadows`, read at each
 *  frame's shadow planning (`../../lighting/shadows/vsm/frame/vsmFarShadow.ts`); the motion blur's
 *  drawing (`../../../../sdk-core/src/contracts/motionBlurOptions.ts`), written by
 *  `setMotionBlur`, read at each image by the blur (`../../frame/render/encodeEffects.ts`);
 *  the depth of field's drawing (`../../../../sdk-core/src/contracts/depthOfFieldRules.ts`), written by
 *  `setDepthOfField`, read at each image by the depth of field (`../../frame/render/encodeEffects.ts`);
 *  the bloom's drawing (`../../../../sdk-core/src/contracts/bloomRules.ts`), written by `setBloom`,
 *  read at each image by the bloom (`../../frame/render/encodeEffects.ts`);
 *  the Gaussian blur's (`../../../../sdk-core/src/contracts/gaussianBlurRules.ts`), written by
 *  `setGaussianBlur`, read at each image by the bloom and by the local exposure
 *  (`../../post/finish/frame.ts`);
 *  the film effects' (`../../../../sdk-core/src/contracts/filmOptions.ts`), written by `setFilm`,
 *  read at each image by the finishing (`../../post/finish/frame.ts`);
 *  the colour grading's (`../../../../sdk-core/src/contracts/colorGradingOptions.ts`), written by
 *  `setColorGrading`, read at each image by the tone table's baking (`../../post/finish/toneFrame.ts`);
 *  the volumetric fog's (`../../../../sdk-core/src/contracts/volumetricFogOptions.ts`), written by
 *  `setVolumetricFog`, read at each image by the fog volume (`../../frame/render/encodeFogVolume.ts`);
 *  the translucency lighting volume's (`../../../../sdk-core/src/contracts/translucencyVolumeOptions.ts`), written by
 *  `setTranslucencyVolume`, read at each image by the volume's injection (`../../lighting/translucency/frame.ts`);
 *  the screen-space subsurface scattering's (`../../../../sdk-core/src/contracts/subsurfaceScatteringOptions.ts`), written by
 *  `setSubsurfaceScattering`, read at each image by its passes (`../../lighting/subsurface/frame.ts`);
 *  the screen probes' (`../../../../sdk-core/src/bounce/screenProbeOptions.ts`), written by
 *  `setIndirectLight`, read at each image by the probes (`../../lighting/bounce/screen/frame.ts`);
 *  the reflections' trace's (`../../../../sdk-core/src/contracts/reflectionOptions.ts`), written by
 *  `setReflections`, read at each image by the trace (`../../lighting/reflections/frame.ts`);
 *  the screen-space ambient occlusion's (`../../../../sdk-core/src/contracts/ambientOcclusionOptions.ts`), written by
 *  `setAmbientOcclusion`, read at each image by its passes (`../../lighting/ao/frame.ts`);
 *  the sky's quality (`../../../../sdk-core/src/modules/sky/quality.ts`), written by `setSkyQuality`,
 *  read at each image by the atmosphere (`../../frame/render/encodeAtmosphere.ts`);
 *  the depth pyramid's (`../../../../sdk-core/src/contracts/hizOptions.ts`), written by `setHiz`,
 *  read at each image by the reflections' depth pyramid (`../../lighting/reflections/frame.ts`) and
 *  the transparent clusters' test (`../../blend/transparent/occlusionHost.ts`);
 *  the light functions' (`../../../../sdk-core/src/contracts/lightFunctionOptions.ts`), written by
 *  `setLightFunction`, read at each image by the atlas (`../../lighting/lightFunction/frame.ts`);
 *  the software raster, on by default, the projected edge in pixels from which a cluster is
 *  the hardware rasterizer's, and the ordering of its cutout clusters by depth bucket
 *  (`../../../../sdk-core/src/contracts/rasterOptions.ts`), written by
 *  `setSoftwareRaster`, `setHardwareRasterEdgePixels`, `setDepthBucketing`, `setDepthBucketsMinZ`
 *  and `setDepthBucketsMaxZ` and read each image by the cluster split
 *  (`../../visibility/passes/uniforms.ts`); the geometry streaming's settings
 *  (`../../../../sdk-core/src/contracts/streamingOptions.ts`), written by `setStreaming` and read
 *  by each update of the streaming (`../../geometry/residency/queue.ts`). */
export interface EngineContext extends SettingOptions {
  source: Object3D
  metadata: ClusterManifest
  indices: Map<string, Uint32Array>
  /** What the session draws, source by source: its geometry, surface and primitive ranks, and the
   *  instance rows that place it in place of a node's pose (`geometry/selection/drawSource.ts`). */
  draws: readonly DrawSource[]
  /** The caches the drawn textures come from — the session's own, each model a world adds —: the
   *  chain of each texture and the reader of its levels (`../../materials/texture/textureCaches.ts`). */
  textureCaches: TextureCaches
  signal?: AbortSignal
  /** The most 128 KiB streaming pages the geometry pool's streaming slots hold, the root region's
   *  grains apart (`../memory/pools.ts`, `page-cap`): benches and tests bound the pool by it. */
  maxResidentPages?: number
  pixelError?: number
  /** Presentation clear color supplied by the host, encoded as 0xRRGGBB. */
  clearColor?: number
  /** Bounded diagnostics emitted by the engine and owned by the host report. */
  onDiagnostic?: (diagnostic: EngineDiagnostic) => void
  /** Named at each step preparation awaits: what an opening that never ends is waiting in. */
  preparationStep?: (step: string) => void
  /** Summary suppresses per-frame trace records; trace is the default with an observer. */
  diagnosticDetail?: DiagnosticDetail
  viewport?: [number, number]
  /** Image pixels per CSS pixel, read each frame: the host's `pixelRatio`, which a resize may
   *  change. A line's `linewidth` counts CSS pixels, so a line keeps its look when the pixel ratio changes. */
  pixelRatio?: () => number
  /** The world's time, in seconds, read at each image (`MeasuredWorldOptions.worldClock`): what the
   *  automatic exposure adapts on, the difference between two images, and what the `time` of a
   *  material graph reads (`materials/graph/clocks.ts`). Absent, the image clock. */
  worldClock?: () => number
  gpuDevice?: GPUDevice
  gpuCanvas?: HTMLCanvasElement // a host canvas dedicated to the engine
  /** Texture-tile bytes and tile-copy CPU milliseconds admitted per frame; the rest waits. */
  maxTextureTransferBytesPerFrame?: number
  maxTextureUploadMsPerFrame?: number
  /** Geometry-page pool bytes of the streamed pages — slots of a 128 KiB streaming page each —,
   *  fixed regardless of the scene; 512 MiB by default. The root pages are held beside them, in
   *  the pool's root region, never in them; what does not fit draws coarser, image targets follow
   *  resolution. The per-page tables start at it and grow in place for a larger one
   *  (`setMemoryBudgets`). */
  geometryPoolBytes?: number
  admitGpuMemory?: AdmitGpuMemory // active allocations through the world's one global budget
  /** Virtual-texture pool bytes, shared by the colour and data atlases; 512 MiB by default. A view
   *  beyond it waits; `textureCompression`: the block family, `'auto'` what the device samples. */
  texturePoolBytes?: number
  textureCompression?: import('../../materials/texture/blockFormats.ts').TextureCompression
  /** Temporal antialiasing's level (`TEMPORAL_AA_LEVELS`), the default one by default, `true` the
   *  same: `false` or `'off'` renders the image sampled at the pixel centre, no jitter, no
   *  history. `renderScale`: the display resolution's default when absent,
   *  1 draws at the display's own size (`renderScaleOption.ts`). */
  temporalAntialiasing?: boolean | TemporalAntialiasingLevel
  renderScale?: import('../../frame/scale/renderScaleOption.ts').RenderScale
  /** The interactive loop's frame cap, frames a second (`../../frame/cadence.ts`); none when
   *  absent. */
  maxFrameRate?: number
  /** The world's effect chain, drawn after temporal antialiasing; absent or empty, nothing is. */
  effects?: import('../../../../sdk-core/src/world/effect/chain.ts').EffectChain
  /** The world's guides, drawn over the image, and its particle pools, stepped once per image. */
  guides?: import('../../guides/guideSet.ts').GuideSet
  particles?: readonly import('../../../../sdk-core/src/fluids/particles.ts').ParticlePool[]
  sceneLights?: SceneLightStore // the host's contract lights, shared by the session's engines
  /** The meshes' distance fields the cache carries (`distanceFields.bin`), none for a cache without. */
  distanceFields?: readonly MeshDistanceField[]
  /** The cards the meshes keep (`meshCards.bin`), none for a cache whose meshes kept none. */
  meshCards?: readonly MeshCards[]
  /** The scene's volumetric lightmap (`volumetric-lightmap.bin`), none for a cache whose job baked none. */
  volumetricLightmapData?: VolumetricLightmapData
  /** Reads the bricks of one of its streaming cells (`readVolumetricLightmap`); none for a lightmap with all its bricks in its layers. */
  readVolumetricLightmapCell?: ReadLightmap['readCell']
  sceneVolumes?: SceneFogVolumeStore // the objects voxelised into the fog's volume, shared likewise
  sceneLocalFog?: SceneLocalFogStore // the local fog volumes, shared likewise
  importedLightIds?: string[] // imported light ids in cache order, set by `importedLights()`
  /** Bounced light, on by default (`false` turns it off); `bounceProbesPerFrame`, the probes a frame traces,
   *  those never traced first, a whole map each (the screen probes' level's budget where none is named, at most 768). */
  bounce?: boolean
  bounceProbesPerFrame?: number
  stageProfile?: boolean // Off by default; the bench and harness time the frame steps.
  feedbackTargetAB?: boolean
  /** A still view's temporal pass drawn every frame once its history is whole, never held on the
   *  converged image (`taaConverging`): off by default; the bench's cost series set it. */
  drawConverged?: boolean
  /** DIAGNOSTIC variant kept by the host, checked (`../../diagnostic/gpuVariant.ts`); absent in production. */
  diagnosticGpuVariant?: import('../../diagnostic/gpuVariant.ts').DiagnosticGpuVariant
  readPage?: (url: string) => Promise<Uint32Array> // Validated reader of a page not yet in memory.
  /** Catalogues the pages of a primitive added to the manifest after the open, before they are
   *  read (`PageQueue.admit`). */
  admitPages?: (pages: readonly StreamPage[]) => void
  /** What the session running cannot take of the content it was handed, found after the hand-over
   *  (`MeasuredWorldOptions.onContentRefused`): the engine keeps the cut it runs. */
  onContentRefused?: (what: string, reason: string) => void
  /** Reader of the cache's geometry pages; absent from a cache that carries none, whose slots are
   *  written from the index pages the arrivals left in memory (`../../frame/backend/readPage.ts`). */
  readGeometryPage?: (url: string, signal?: AbortSignal, priority?: number) => Promise<Uint8Array>
  /** Whether the read of a geometry page is refused for good: the page was given up, or another
   *  page of its object was (`../../geometry/streaming/pageStreamer.ts`, `failed`); absent: never. */
  geometryPageFailed?: (url: string) => boolean
  /** The world roots this scene's manifest opened, whose DAG the cut packs; their pages are read
   *  as any geometry page (`../../geometry/hlod/worldRuns.ts`); absent without them. */
  worldRoots?: import('../../geometry/hlod/worldRoots.ts').WorldRootsHold
  /** The session's one integration budget per frame (`integration/frameBudget.ts`); absent, nothing bounds it. */
  frameBudget?: import('../../geometry/integration/frameBudget.ts').FrameClock
}
