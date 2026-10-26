import type { ComposeState } from '../../placement/compose/gpuComposeState.ts'
import type { RootWorlds } from '../../placement/roots/rootWorlds.ts'
import type { RootBoxesGpu } from '../../placement/roots/rootBoxes.ts'
import type { TreeLeavesGpu } from '../../placement/tree/treeLeaves.ts'
import type { GrowthInFlight } from '../../placement/growth/webgpuGrowth.ts'
import type { RayQueue } from '../../lighting/rays/rayQueue.ts'
import type { DistanceFieldFrameState } from '../../lighting/distanceField/frame.ts'
import type { SurfaceCacheFrameState } from '../../lighting/surfaceCache/frame.ts'
import type { VolumetricLightmapFrameState } from '../../lighting/volumetricLightmap/frame.ts'
import { explorerSwitch } from '../../../../sdk-core/src/runtime/explorerSwitches.ts'
import { TAA_CAPABILITIES } from '../../post/taa/capability.ts'
import { BOUNCE_CAPABILITY } from '../prepare/bounce.ts'
import type { EngineCapabilities } from '../../../../sdk-core/src/contracts/metrics.ts'
import type { EngineContext } from '../../session/engine/types.ts'
import { createWebgpuPagesServices, type WebgpuPagesServices } from './services.ts'
import { createWebgpuDiagnostics } from '../io/diagnostics.ts'
import { createWebgpuBlendState, type WebgpuBlendState } from '../../blend/state.ts'
import { createWebgpuPagesSetup, type WebgpuDiagnostics } from '../prepare/setup.ts'
import { createWebgpuPagesLayout, type WebgpuPagesLayout } from '../prepare/layout.ts'
import { createWebgpuGpuState, type WebgpuGpuState } from './state/gpu.ts'
import { createWebgpuVisState, type WebgpuVisState } from './state/vis.ts'
import { createWebgpuLightState, type WebgpuLightState } from './state/lights.ts'
import { createWebgpuBounceState, type WebgpuBounceState } from './state/bounce.ts'
import { createWebgpuRunState } from './state/runState.ts'
import type { WebgpuRunState } from './state/run.ts'
import { createWebgpuCaptureState, type WebgpuCaptureState } from './state/capture.ts'
import { createWebgpuViews, type WebgpuViews } from './state/view.ts'
import { createScaleControl } from '../scale/scaleControl.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'
import { createWebgpuTimingState, type WebgpuTimingState } from './state/timing.ts'
import { WEBGPU_STAGES } from '../../diagnostic/stage/passDeclaration.ts'
import type { WebgpuPagesSetup } from '../prepare/setup.ts'
import type { FeedbackAbState } from '../../diagnostic/feedback/feedbackAb.ts'
import type { VisPage } from '../../visibility/types.ts'
import type { PageLocations } from '../../geometry/selection/placements.ts'
import { createFrameBudget, type FrameClock } from '../../geometry/integration/frameBudget.ts'

export type RasterView = {
  pages: VisPage[]
  locations: PageLocations
  cam: EngineCamera
  size: [number, number]
  pixelRatio: number
  clearColor: number
}

/** The runtime before its services exist: what the service factory and the draw helpers are handed. */
export type WebgpuPagesCore = Omit<WebgpuPagesRuntime, 'services'>

/** The shared state of one WebGPU page-raster backend, handed to every module that implements a
 *  part of it. `setup` and `layout` change only as the session grows (`../io/memory.ts`, `../prepare/catalogueGrowth.ts`); the
 *  other groups do as they draw. */
export interface WebgpuPagesRuntime {
  context: EngineContext
  /** The session's one main-thread clock (`EngineContext.frameBudget`), which the rows, the texture
   *  tiles and the residency queue spend as stages of its frame; an engine no frame drives has none
   *  to share, and nothing bounds it: a clock of no ceiling. */
  clock: FrameClock
  /** Opt-in, same-session frame-target measurement; absent from production sessions. */
  feedbackAB?: FeedbackAbState
  /** Aborted by `dispose`; `signal` is aborted by it or by the session's. */
  closer: AbortController
  signal: AbortSignal
  diag: WebgpuDiagnostics
  setup: WebgpuPagesSetup
  layout: WebgpuPagesLayout
  gpu: WebgpuGpuState
  vis: WebgpuVisState
  /** Contract lights, their per-tile lists and their shadow maps. */
  lights: WebgpuLightState
  /** Resident proxy and probe grid of bouncing light. */
  bounce: WebgpuBounceState
  run: WebgpuRunState
  capture: WebgpuCaptureState
  /** Every camera-bound field above belongs to `views.active`; `./state/viewSwitch.ts` switches. */
  views: WebgpuViews
  timing: WebgpuTimingState
  capabilities: EngineCapabilities
  blendState: WebgpuBlendState
  /** The nodes the host may write, listed by frame entry at a scene change only (`gateCore.ts`):
   *  built once, so an image hands over no new closure. */
  watchedSources: () => unknown[]
  /** Residency machinery, built once the state exists; it reads the runtime lazily. */
  services: WebgpuPagesServices
  /** Placements composed on the GPU under a moved parent (`../../placement/compose/gpuCompose.ts`). */
  compose?: ComposeState
  /** Every root's world in doubles on the GPU (`../../placement/roots/rootWorlds.ts`). */
  rootWorlds?: RootWorlds
  /** The root boxes pass and the tree's leaves on the GPU (`../../placement/roots/rootBoxes.ts`,
   *  `../../placement/tree/treeLeaves.ts`). */
  rootBoxes?: RootBoxesGpu
  treeLeaves?: TreeLeavesGpu
  /** The rows grown in place and the roots waiting to join the cut, until a cut holds them
   *  (`../../placement/growth/webgpuGrowth.ts`). */
  growth?: GrowthInFlight
  /** The rays cast at the engine, made at the first (`../../lighting/rays/rayQueue.ts`). */
  rays?: RayQueue
  /** The meshes' distance fields and the global field composited from them, made at the first image
   *  of a session whose cache carries any (`../../lighting/distanceField/frame.ts`). */
  distanceFields?: DistanceFieldFrameState
  /** The surface cache of the meshes' cards — its atlas, its tables, its capture —, made at the first image that
   *  asks for it, of a session whose cache carries cards (`../../lighting/surfaceCache/frame.ts`). */
  surfaceCache?: SurfaceCacheFrameState
  /** The scene's volumetric lightmap on the GPU, made once at the first image that reads it
   *  (`../../lighting/volumetricLightmap/frame.ts`). */
  volumetricLightmap?: VolumetricLightmapFrameState
}

/** What is withheld until served: a capability leaves the list as it is granted (`grantCapability`). */
const initialCapabilities = (): EngineCapabilities => ({
  unsupported: [
    'material extensions',
    'per-texture transforms, UV channels and sampler modes',
    'environment maps and light probes',
    'contract scene lights with shadow atlas',
    'physical VRAM instrumentation',
    BOUNCE_CAPABILITY,
    ...TAA_CAPABILITIES,
    'sun shadows beyond the last clipmap level',
    'direct WebGPU present',
  ],
})

export function createWebgpuPagesRuntime(context: EngineContext): WebgpuPagesRuntime {
  const traceEnabled = !!context.onDiagnostic && context.diagnosticDetail !== 'summary'
  const closer = new AbortController()
  const signal = context.signal ? AbortSignal.any([context.signal, closer.signal]) : closer.signal
  const diag = {
    ...createWebgpuDiagnostics(context.onDiagnostic, traceEnabled, signal),
    traceEnabled,
  }
  const setup = createWebgpuPagesSetup(context, diag)
  const gpu = createWebgpuGpuState(setup.viewport)
  // A page's slot is read on the cache, the truth, never mirrored (`../../geometry/clusters/pageState.ts`).
  const layout = createWebgpuPagesLayout(setup, (address) => gpu.cache?.slotWords(address) ?? -1)
  const vis = createWebgpuVisState()
  const run = createWebgpuRunState(context.clearColor)
  const blendState = createWebgpuBlendState(context)
  const lights = createWebgpuLightState(context.sceneLights)
  const capabilities = initialCapabilities()
  const timing = createWebgpuTimingState(
      explorerSwitch(context, 'stageProfile') ? WEBGPU_STAGES : undefined,
      () => layout.selectionRoots.length,
    ),
    scale = createScaleControl(context.renderScale, context.maxFrameRate)
  const core: WebgpuPagesCore = {
    context,
    clock: context.frameBudget ?? createFrameBudget(Infinity),
    closer,
    signal,
    diag,
    setup,
    layout,
    gpu,
    vis,
    lights,
    bounce: createWebgpuBounceState(
      explorerSwitch(context, 'bounce'),
      context.bounceProbesPerFrame,
    ),
    run,
    capture: createWebgpuCaptureState(),
    views: createWebgpuViews({ run, gpu, vis, setup, timing }, scale),
    timing,
    capabilities,
    blendState,
    watchedSources: () => [
      ...layout.selectionRoots.map((root) => root.pages[0]),
      ...blendState.blendGpu,
    ],
  }
  return { ...core, services: createWebgpuPagesServices(core) }
}
