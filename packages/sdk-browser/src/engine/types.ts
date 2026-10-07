import type { AdmitGpuMemory } from '../residency/activeMemory.ts'
import type { HostScene, HostTexture } from '../host/resources.ts'
import type { HostCamera } from '../camera/world.ts'
import type {
  EngineCapabilities,
  ClusterManifest,
  DiagnosticMode,
  SceneLightStore,
  StageProfile,
} from '../../../sdk-core/src/index.ts'
import type { EngineDrawCounters, EngineMetrics } from '../diagnostic/metricKeys.ts'
import type { MemoryBudgets, MemoryBudgetsReport } from '../residency/pools.ts'
import type { CpuStepSummary } from '../stage/cpuProfile.ts'
import type { HostCpuStep } from '../host/cpuProfile.ts'
import type { EngineDiagnostic, DiagnosticDetail } from '../diagnostic/types.ts'
import type { PlacementRows } from '../placement/rows.ts'
import type { EngineSceneUpdates } from '../placement/engineSceneUpdates.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { EngineProbes } from './probes.ts'
export type { EngineCapabilities, EngineDiagnostic, DiagnosticDetail }
type ViewSize = { width: number; height: number }
/** The engine: the WebGPU page raster (`../webgpu/pages/pages.ts`), the session's one renderer.
 *  Every member is its own and required; a test's stand-in casts a partial one. */
export interface Engine extends EngineSceneUpdates, EngineProbes {
  id: string
  capabilities: EngineCapabilities
  setDiagnostic(mode: DiagnosticMode): void
  /** The contract light store has changed: the next frame will reread it. */
  refreshSceneLights(): void
  /** Extra lighting facts: shadow support and a reason when absent. */
  lighting: { shadows: boolean; reason?: string }
  /** Sets memory pools during the session; returns what the engine holds afterwards. */
  setMemoryBudgets(budgets: MemoryBudgets): Promise<MemoryBudgetsReport>
  signal: AbortSignal // Aborted by its dispose or its session's: `prepare` then fails as cancelled.
  prepare(): Promise<void>
  render(camera: HostCamera): void
  readonly overBudget: boolean
  scene: HostScene
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
  /** A bound the host recorded itself — outside the frame it would have lengthened —, slotted in
   *  the engine's own bound table. */
  cpuStep(step: HostCpuStep, ms: number): void
  /** The host's share of the frame ended: the bounds it just sampled belong to this frame. */
  cpuFrameEnd(): void
  /** The frame's CPU time, the number the stats corner shows (`FrameMetrics.cpuFrameMs`). */
  frameCpuMs(ms: number): void
  /** What the GPU partition of the last frame wrote, and the inputs it drew it from: the proof,
   *  cluster by cluster, that its rectangles and depths are conservative. */
  partitionAudit(): Promise<import('../webgpu/core/partitionAudit.ts').PartitionAudit | null>
  /** What the transparent occlusion test rejected, and the depth it rejected against: the proof
   *  that no removed cluster would have written a pixel. */
  transparentOcclusionAudit(): Promise<
    import('../webgpu/transparent/occlusionAudit.ts').TransparentOcclusionAudit | null
  >
  /** The pages the last cut asked for and the session holds no bytes of. */
  pendingUrls(): string[]
  /** Every page the last cut asked for. */
  pageUrls(): string[]
  /** Page pins as a difference of request ranks: what entered and left since the last image. */
  retainedRanks(): import('../streaming/types.ts').HostRetentionDelta
  /** The catalogue integer sheet for a request: what off-thread integration plans. */
  pageSpecs(url: string): Int32Array | undefined
  acceptPage(
    url: string,
    array: Uint32Array,
    plan?: import('../page/integration/host.ts').ArrivalPlan,
  ): void
  dropPage(url: string): void
  /** Bytes of the cut's host tables now — the GPU cut publication's host mirrors, sized by the
   *  view and the pool: the CPU total holds them beside the pages the streamer caches
   *  (`../residency/memoryBudget.ts`). */
  hostTableBytes(): number
  syncResident(): void
  flush(options?: { image?: boolean }): Promise<void> // image: false skips the readback
  /** Wait for submitted work without image readback; true asks for another interactive frame. */
  pendingFrame(): Promise<boolean>
  /** The interactive loop's frame began: true where the engine holds it, drawing nothing, to
   *  measure the display (`../webgpu/frame/interactiveFrame.ts`); an explicit render never is. */
  measureFrame(): boolean
  /** What the view received so far — camera pages made resident, quiet images a still average not
   *  yet whole took —: the view still arriving, which spends no settle limit (#836). */
  landings(): number
  /** Current GPU image, bottom-left origin, read back without stalling a frame: the one the last
   *  flush read when it is still current. */
  capture(): Promise<Uint8Array>
  /** The composed image of `camera` at a size of its own, drawn aside: nothing is presented. */
  captureColorView(camera: HostCamera, size: ViewSize): Promise<Uint8Array>
  captureSurfaceView(
    camera: HostCamera,
    options: { width: number; height: number; signal?: AbortSignal },
  ): Promise<import('../scene/surfaceBuffer.ts').SurfaceCapture>
  dispose(): void | Promise<void> // A release that finishes later resolves when it has.
}
export interface EngineContext {
  source: Object3D
  metadata: ClusterManifest
  indices: Map<string, Uint32Array>
  /** Node → primitive; `placements`, the instance rows drawn in place of its pose (`rows.ts`). */
  associations: Map<Object3D, { meshes?: number; primitives?: number; placements?: PlacementRows }>
  /** glTF rank of each texture of the prepared scene, to tie an atlas layer to its preview. */
  textureIndices?: Map<HostTexture, number>
  /** Reader of texture levels baked in the cache; absent from a cache that has none. */
  readTextureLevel?: import('../texture/levelReader.ts').TextureLevelReader
  signal?: AbortSignal
  maxResidentPages?: number
  maxCachedPages?: number
  pixelError?: number
  lodAdaptive?: boolean
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
  gpuDevice?: GPUDevice
  gpuCanvas?: HTMLCanvasElement // a host canvas dedicated to the engine
  /** Texture-tile bytes and tile-copy CPU milliseconds admitted per frame; the rest waits. */
  maxTextureTransferBytesPerFrame?: number
  maxTextureUploadMsPerFrame?: number
  /** Geometry-page pool bytes, fixed regardless of the scene; 512 MiB by default. The root cover
   *  always fits, the rest draws coarser when it does not fit, image targets follow resolution.
   *  The per-page tables start at it and grow in place for a larger one (`setMemoryBudgets`). */
  geometryPoolBytes?: number
  admitGpuMemory?: AdmitGpuMemory // active allocations through the world's one global budget
  /** Virtual-texture pool bytes, shared by the colour and data atlases; 512 MiB by default. A view
   *  beyond it waits; `textureCompression`: the block family, `'auto'` what the device samples. */
  texturePoolBytes?: number
  textureCompression?: import('../texture/blockFormats.ts').TextureCompression
  /** Temporal antialiasing, on by default: `false` renders the image sampled at
   *  the pixel centre, no jitter, no history. `renderScale`: 1 when absent (`renderScaleOption.ts`). */
  temporalAntialiasing?: boolean
  renderScale?: import('../frame/renderScaleOption.ts').RenderScale
  unboundedReflections?: boolean // a reference session's rough trace (`reflectionTrace`, #33)
  /** The world's effect chain, drawn after temporal antialiasing; absent or empty, nothing is. */
  effects?: import('../../../sdk-core/src/world/effect/chain.ts').EffectChain
  sceneLighting?: Object3D
  /** The world's guides, drawn over the image, and its particle pools, stepped once per image. */
  guides?: import('../guides/guideSet.ts').GuideSet
  particles?: readonly import('../../../sdk-core/src/fluids/particles.ts').ParticlePool[]
  sceneLights?: SceneLightStore // the host's contract lights, shared by the session's engines
  importedLightIds?: string[] // imported light ids in cache order, set by `importedLights()`
  /** Bounced light, off by default; `bounceBudgetMs`, its GPU target a frame (0.8 ms by default). */
  bounce?: boolean
  bounceBudgetMs?: number
  stageProfile?: boolean // Off by default; the bench and harness time the frame steps.
  feedbackTargetAB?: boolean
  /** DIAGNOSTIC variant kept by the host, checked (`../diagnostic/gpuVariant.ts`); absent in production. */
  diagnosticGpuVariant?: import('../diagnostic/gpuVariant.ts').DiagnosticGpuVariant
  /** Reads the cache's resident-proxy object once, at the first lit frame; absent without one. */
  readSceneProxy?: () => Promise<import('../../../sdk-core/src/index.ts').SceneProxy>
  readPage?: (url: string) => Promise<Uint32Array> // Validated reader of a page not yet in memory.
  /** Reader of the cache's geometry pages; absent from a cache that carries none, whose slots are
   *  written from the index pages the arrivals left in memory (`../webgpu/pages/readPage.ts`). */
  readGeometryPage?: (url: string, signal?: AbortSignal, priority?: number) => Promise<Uint8Array>
  /** The world roots this scene's manifest opened, whose DAG the cut packs and whose pages
   *  `readGeometryPage` serves (`../scene/worldRoots.ts`); absent without them. */
  worldRoots?: import('../scene/worldRoots.ts').WorldRootsHold
  pageRoundTripMs?: () => number // the reads' measured round trip (`../streaming/roundTrip.ts`)
  /** The session's one integration budget per frame (`frameBudget.ts`); absent, nothing bounds it. */
  frameBudget?: import('../page/integration/frameBudget.ts').FrameClock
}
export type { EngineFactory } from './factory.ts'
export type { MeasuredWorldOptions, PointOfInterest } from '../world/session/options.ts'
