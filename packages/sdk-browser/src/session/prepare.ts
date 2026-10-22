import type { EngineContext, Engine } from './engine/types.ts'
import { configureExplorer } from './capabilities.ts'
import { probeExplorerCapabilities } from './capabilityProbe.ts'
import { prepareExplorerEngine } from './engine.ts'
import { createExplorerCamera } from '../camera/session/camera.ts'
import { openExplorerPageSources, type ExplorerPageSources } from './pageSources.ts'
import {
  STREAMING_RULES,
  type StreamingOptions,
} from '../../../sdk-core/src/contracts/streamingOptions.ts'
import { readSetting } from '../../../sdk-core/src/contracts/settingRules.ts'
import { primeFirstView, sessionScene } from './sessionScene.ts'
import { streamFailed } from '../scene/drive/streaming.ts'
import { loadPreparedScene } from '../scene/drive/scene.ts'
import { MAIN_THREAD_FRAME_MS } from './engine/common.ts'
import { createFrameBudget } from '../geometry/integration/frameBudget.ts'
import { sessionFamilies } from './familyUse.ts'
import { loadEngine, webgpuEngine } from './engine/factory.ts'
import type { ExplorerSession } from './session.ts'
import type { HostCamera } from '../camera/world.ts'

/** What a session owns as it opens, released by whoever ends it: by its failure path before the
 *  runtime exists (`explorer.ts`), by the runtime's disposal after. */
export type ExplorerResources = {
  source?: EngineContext['source']
  gpuDevice?: GPUDevice
  /** The session's one engine, once prepared. */
  engine?: Engine
  /** The session's read queue, from its opening: an opening that fails closes it. */
  streamer?: ExplorerPageSources['streamer']
  /** Aborted once the opening failed: what a branch of it builds later, it releases itself. */
  opening?: AbortController
}

/** The scene a loader builds: what `loadPreparedScene` returns. */
export type ExplorerScene = Awaited<ReturnType<typeof loadPreparedScene>>

/** A scene the caller already holds, handed to `openMeasuredWorld` in place of a manifest URL. */
export type ExplorerSource = {
  manifestUrl: string
  metadataUrl: string
  base: string
  metadata: import('../../../sdk-core/src/contracts/geometry.ts').ClusterManifest
  scene: Omit<ExplorerScene, 'associations'>
  /** Puts the session's camera where the page draws from, before anything is read for it: a
   *  partitioned scene reads and sizes its cells for that camera, not the framing one. */
  placeCamera?: (camera: HostCamera) => void
  /** Moves a node of the page's own scene by name, when the session draws a world built in code
   *  (`world/runtime.ts`): its engines hold that scene as rows, not as named nodes. */
  moveNamed?: (nodeName: string, matrix: Float32Array) => void
}

export type Inputs = {
  scene?: ExplorerSource['scene']
  placeCamera?: ExplorerSource['placeCamera']
  manifestUrl: string
  metadataUrl: string
  base: string
  resources: ExplorerResources
  progress: (phase: string, completed: number, total: number, message: string) => void
}

/** What `prepareExplorer` resolves to: a session's prepared engine and streams. */
export type PreparedExplorer = Awaited<ReturnType<typeof prepareExplorer>>

/** The camera the first view is framed with, placed, and the first view primed through it. Framing
 *  replays the buffer reserved at load, then returns it: it is its last reader. */
async function frameFirstView(
  session: ExplorerSession,
  inputs: Inputs,
  loadedScene: Awaited<ReturnType<typeof sessionScene>>,
  pageSources: ExplorerPageSources,
) {
  const { canvas, options } = session
  const cameraState = createExplorerCamera(
    loadedScene.source,
    canvas,
    options,
    loadedScene.framingLot,
  )
  loadedScene.framingLot?.release()
  inputs.placeCamera?.(cameraState.camera)
  await primeFirstView(session, loadedScene, cameraState.camera, pageSources.streamer)
  return cameraState
}

export async function prepareExplorer(session: ExplorerSession, inputs: Inputs) {
  const { options, metadata, signal, diagnosticChannel } = session
  const { manifestUrl, metadataUrl, base, resources, progress } = inputs
  // The optional families the first frame draws with load beside the scene (#1353).
  const families = sessionFamilies(options, diagnosticChannel.enabled)
  // The machine is read before the scene: a browser that grants no WebGPU device is refused by
  // name before anything is read for it.
  const { capabilities, gpuDevice } = await probeExplorerCapabilities(session)
  resources.gpuDevice = gpuDevice
  // The WebGPU page raster on the device granted above: its renderer is its own chunk (#1353),
  // loaded beside the scene. A measured page's factory (`options.engine`) carries its own code.
  const factory = options.engine ?? webgpuEngine
  const renderer = options.engine ? undefined : loadEngine()
  // The queue first, the scene loaded through it beside the pages it preloads: their longest
  // wait, not their sum. The queue is the opening's until the session takes it (`resources`).
  // Both branches stop once the opening fails (`failedOpening`): what lands later is released.
  const failed = (resources.opening = new AbortController()).signal
  const live = signal ? AbortSignal.any([signal, failed]) : failed
  // The streaming settings the queue reads its tries again from: the session's options till its
  // engine is built, then the engine's context, which `explorer.setStreaming` writes.
  let streaming: StreamingOptions = options
  const opening = openExplorerPageSources(
    metadata,
    options,
    base,
    live,
    () => resources.engine,
    diagnosticChannel,
    progress,
    (detail, failedPages) => streamFailed(session, resources.engine, failedPages, detail),
    () => readSetting(STREAMING_RULES, streaming, 'streamingNumRetries'),
  )
  resources.streamer = opening.streamer
  const [pageSources, loadedScene] = await Promise.all([
    opening.sources,
    sessionScene(session, inputs, opening.streamer, live),
  ])
  const { source } = loadedScene
  await configureExplorer(session, {
    ...{ manifestUrl, metadataUrl, base },
    draws: loadedScene.draws,
    pageSources,
  })
  const cameraState = await frameFirstView(session, inputs, loadedScene, pageSources)
  // The frame's one main-thread clock: cells, arrivals, the engine's row records and texture tiles.
  const frameBudget = createFrameBudget(MAIN_THREAD_FRAME_MS)
  await renderer // the engine is built once its renderer has arrived
  const { viewport, context, engine, hostBytes } = await prepareExplorerEngine(session, {
    ...{ source, pageSources, gpuDevice, factory, base, frameBudget },
    draws: loadedScene.draws,
    textureCaches: loadedScene.textureCaches,
    worldRoots: loadedScene.worldRoots,
  })
  resources.engine = engine
  streaming = context
  await families
  return {
    source,
    partitions: loadedScene.partitions,
    pageSources,
    capabilities,
    viewport,
    context,
    /** The world roots the engine's host tables count (`hostBytes`): a model joining adds its own. */
    worldRoots: loadedScene.worldRoots,
    frameBudget,
    engine,
    /** The CPU bytes the engine's host tables and the world roots hold now, which each frame
     *  reserves off the page cache (`streamer.reserve`). */
    hostBytes,
    ...cameraState,
  }
}
