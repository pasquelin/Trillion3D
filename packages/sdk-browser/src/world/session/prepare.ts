import type { EngineContext, Engine } from '../../engine/types.ts'
import { resolveTextureSource } from '../../engine/textureSource.ts'
import { configureExplorer } from './capabilities.ts'
import { probeExplorerCapabilities } from './capabilityProbe.ts'
import { prepareExplorerEngine } from './engine.ts'
import { createExplorerCamera } from '../camera/camera.ts'
import { openExplorerPageSources, sceneThrough, type ExplorerPageSources } from './pageSources.ts'
import { streamFailed } from '../scene/streaming.ts'
import { loadPreparedScene } from '../scene/scene.ts'
import { primePartitions } from '../scene/partitionFrame.ts'
import { ARRIVAL_BUDGET_MS } from '../../engine/common.ts'
import { createFrameBudget } from '../../page/integration/frameBudget.ts'
import { sessionFamilies } from './familyUse.ts'
import { loadEngine, webgpuEngine } from '../../engine/factory.ts'
import type { ExplorerSession } from './session.ts'
import type { HostCamera } from '../../camera/world.ts'
import type { PageQueue } from '../../streaming/types.ts'

/** What a session owns as it opens, released by whoever ends it: by its failure path before the
 *  runtime exists (`explorer.ts`), by the runtime's disposal after. */
export type ExplorerResources = {
  source?: EngineContext['source']
  gpuDevice?: GPUDevice
  /** The session's one engine, once prepared. */
  engine?: Engine
  /** The session's read queue, from its opening: an opening that fails closes it. */
  streamer?: ExplorerPageSources['streamer']
}

/** The scene a loader builds: what `loadPreparedScene` returns. */
export type ExplorerScene = Awaited<ReturnType<typeof loadPreparedScene>>

/** A scene the caller already holds, handed to `openMeasuredWorld` in place of a manifest URL. */
export type ExplorerSource = {
  manifestUrl: string
  metadataUrl: string
  base: string
  metadata: import('../../../../sdk-core/src/index.ts').ClusterManifest
  scene: ExplorerScene
  /** Puts the session's camera where the page draws from, before anything is read for it: a
   *  partitioned scene reads and sizes its cells for that camera, not the framing one. */
  placeCamera?: (camera: HostCamera) => void
  /** Moves a node of the page's own scene by name, when the session draws a world built in code
   *  (`../core/worldRuntime.ts`): its engines hold that scene as rows, not as named nodes. */
  moveNamed?: (nodeName: string, matrix: Float32Array) => void
}

type Inputs = {
  scene?: ExplorerScene
  placeCamera?: ExplorerSource['placeCamera']
  manifestUrl: string
  metadataUrl: string
  base: string
  resources: ExplorerResources
  progress: (phase: string, completed: number, total: number, message: string) => void
}

/** The scene the session draws: the one handed in, or the one the cache prepared, read through
 *  `streamer`, the session's queue (`sceneThrough`), its world tops said. `textureSource` is the
 *  loader's, resolved against what the platform can read. */
async function sessionScene(session: ExplorerSession, inputs: Inputs, streamer: PageQueue) {
  const { options, metadata, scope, signal, diagnose } = session
  const { base, resources, progress } = inputs
  const textureSource = resolveTextureSource(options.textureSource)
  diagnose('texture-source', 'Texture source of this session', {
    kind: 'configuration',
    scope,
    textureSource,
  })
  progress(
    'scene',
    0,
    1,
    `Chargement de ${metadata.selectedTriangles.toLocaleString()} triangles (${scope})`,
  )
  const loadedScene = await sceneThrough(streamer, inputs.scene, () =>
    loadPreparedScene(
      { ...options, textureSource, queue: streamer },
      metadata,
      base,
      scope,
      signal,
      diagnose,
      (source) => {
        resources.source = source
      },
    ),
  )
  resources.source = loadedScene.source
  // The runtime's pinned bytes: each model's world top alone, beside what its placed cells hold.
  for (const { pinned, bytes } of loadedScene.worldRoots)
    diagnose('world-top', 'World top pinned', {
      kind: 'preparation',
      scope,
      pinnedBundles: pinned.bundles,
      pinnedBytes: pinned.bytes,
      heldBytes: bytes() - pinned.bytes,
    })
  return loadedScene
}

/** The pages and cells the first camera reaches, placed before the engine reads their rows: the
 *  first frame draws them (`partitionFrame.ts`, #575). That camera is the page's when it hands one
 *  in (a world), else the framing one, which sees the whole scene. */
async function primeFirstView(
  session: ExplorerSession,
  scene: ExplorerScene,
  camera: HostCamera,
  streamer: ExplorerPageSources['streamer'],
) {
  const { options, scope, signal, diagnose } = session
  if (!scene.partitions.length) return
  const bytes = await primePartitions(
    scene.partitions,
    camera,
    streamer,
    !!options.onPartitionOutgrown,
    signal,
  )
  diagnose('partition', 'Pages and cells read before the first frame', {
    kind: 'preparation',
    scope,
    bytes,
    cells: scene.partitions.map((cells) => cells.stats()),
  })
}

export async function prepareExplorer(session: ExplorerSession, inputs: Inputs) {
  const { canvas, options, metadata, signal, diagnosticChannel } = session
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
  const opening = openExplorerPageSources(
    metadata,
    options,
    base,
    signal,
    () => resources.engine,
    diagnosticChannel,
    progress,
    (detail, failedPages) => streamFailed(session, resources.engine, failedPages, detail),
  )
  resources.streamer = opening.streamer
  const [pageSources, loadedScene] = await Promise.all([
    opening.sources,
    sessionScene(session, inputs, opening.streamer),
  ])
  const { source } = loadedScene
  await configureExplorer(session, { manifestUrl, metadataUrl, base, source, pageSources })
  // Framing replays the buffer reserved at load, then returns it: it is its last reader.
  const cameraState = createExplorerCamera(source, canvas, options, loadedScene.framingLot)
  loadedScene.framingLot?.release()
  inputs.placeCamera?.(cameraState.camera)
  await primeFirstView(session, loadedScene, cameraState.camera, pageSources.streamer)
  // The frame's one integration budget: cells, arrivals, then the engine's row records.
  const frameBudget = createFrameBudget(ARRIVAL_BUDGET_MS)
  await renderer // the engine is built once its renderer has arrived
  const { viewport, context, engine } = await prepareExplorerEngine(session, {
    ...{ source, pageSources, gpuDevice, factory, base, frameBudget },
    sceneLightingSource: loadedScene.sceneLightingSource,
    associations: loadedScene.associations,
    textureIndices: loadedScene.textureIndices,
    worldRoots: loadedScene.worldRoots,
  })
  resources.engine = engine
  await families
  const { partitions } = loadedScene
  return {
    source,
    partitions,
    pageSources,
    capabilities,
    viewport,
    context,
    frameBudget,
    engine,
    ...cameraState,
  }
}
