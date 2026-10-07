import { explorerSwitch } from '../../../../sdk-core/src/runtime/explorerSwitches.ts'
import { worldOrGeometryReader, type WorldRootsHold } from '../../scene/worldRoots.ts'
import type { HostTexture } from '../../host/resources.ts'
import { DEFAULT_CLEAR_COLOR, isCancelled, pixelRatioOf } from '../../engine/common.ts'
import { createSceneLightStore, dagWarningsDiagnostic } from '../../../../sdk-core/src/index.ts'
import { createSceneProxyReader } from '../../scene/proxyLoad.ts'
import { createTextureLevelReader } from '../../texture/levelReader.ts'
import { resolveDiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts'
import { declareImportedLights, loadImportedLights } from '../../lighting/importedLights.ts'
import type { EngineContext, EngineFactory, Engine } from '../../engine/types.ts'
import type { createExplorerPageSources } from './pageSources.ts'
import type { ExplorerSession } from './session.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'

type Inputs = {
  source: Object3D
  sceneLightingSource?: Object3D
  associations: EngineContext['associations']
  textureIndices: Map<HostTexture, number>
  pageSources: Awaited<ReturnType<typeof createExplorerPageSources>>
  gpuDevice?: GPUDevice
  /** What builds the session's engine: the WebGPU page raster's factory. */
  factory: EngineFactory
  /** Manifest url base: that is what locates the resident-proxy cache object. */
  base: string
  frameBudget?: EngineContext['frameBudget']
  /** Each model's world roots: the pinned top and the bundles its placed cells hold (#1237). */
  worldRoots: readonly WorldRootsHold[]
}

/** One light store per session, the engine reads it and the host writes it, with the lights the
 *  source file carried declared before the engine: the `auto` view knows from its first frame
 *  that it has a source, and no engine prepares on an empty store that would then be pushed. A
 *  cache without this product declares none. What the compiler named without being able to fix
 *  it — a DAG that is not mounted — is said at open too: a fact of the cache. */
async function sessionLights(session: ExplorerSession, base: string) {
  const { options, scope, metadata, signal, diagnose } = session
  const sceneLights = createSceneLightStore()
  let importedLightIds: string[] = []
  if (explorerSwitch(options, 'importedLights')) {
    const imported = await loadImportedLights(base, signal)
    importedLightIds = declareImportedLights(sceneLights, imported.lights)
    if (importedLightIds.length || Object.keys(imported.rejected).length)
      diagnose('imported-lights', 'Lights declared by the source file', {
        kind: 'preparation',
        declared: importedLightIds.length,
        rejected: imported.rejected,
        scope,
      })
  }
  const dagWarnings = dagWarningsDiagnostic(metadata)
  if (dagWarnings)
    diagnose(dagWarnings.phase, dagWarnings.message, {
      kind: 'preparation',
      ...dagWarnings.context,
    })
  return { sceneLights, importedLightIds }
}

/** What the session's options hand the engine as they are. */
function optionContext(session: ExplorerSession) {
  const { options, diagnosticChannel } = session
  return {
    maxResidentPages: options.maxResidentPages,
    pixelError: options.pixelError ?? 0,
    lodAdaptive: options.lodAdaptive,
    clearColor: options.clearColor ?? DEFAULT_CLEAR_COLOR,
    pixelRatio: () => pixelRatioOf(options),
    maxTextureTransferBytesPerFrame: options.maxTextureTransferBytesPerFrame,
    maxTextureUploadMsPerFrame: options.maxTextureUploadMsPerFrame,
    temporalAntialiasing: options.temporalAntialiasing,
    renderScale: options.renderScale,
    unboundedReflections: options.reference === true,
    effects: options.effects,
    geometryPoolBytes: options.geometryPoolBytes,
    admitGpuMemory: options.admitGpuMemory,
    texturePoolBytes: options.texturePoolBytes,
    textureCompression: options.textureCompression,
    stageProfile: options.stageProfile,
    feedbackTargetAB: options.feedbackTargetAB === true,
    // The diagnostic variant is checked here, once: outside `trace`, it is refused.
    diagnosticGpuVariant: resolveDiagnosticGpuVariant(
      options.diagnosticGpuVariant,
      diagnosticChannel.detail,
    ),
    guides: options.guides,
    particles: options.particles,
    // Bounced light stays off unless asked: its step holds 1.1 to 1.3 ms on Emerald, above 1 ms.
    bounce: options.bounce,
    bounceBudgetMs: options.bounceBudgetMs,
  }
}

/** The context the engine is built on: the scene, the readers of the cache, the session's lights. */
function engineContext(
  session: ExplorerSession,
  inputs: Inputs,
  lights: Awaited<ReturnType<typeof sessionLights>>,
): EngineContext {
  const { canvas, options, metadata, signal, diagnosticChannel, diagnose } = session
  const { indices, streamer, cacheCap } = inputs.pageSources
  // The world roots the scene's own manifest opened ride the context; their pages are read through
  // the one geometry reader, built here once.
  const worldRoots = inputs.worldRoots.find((hold) => hold.metadata === metadata)
  return {
    ...optionContext(session),
    source: inputs.source,
    metadata,
    indices,
    // The session's reads: the engine's own signal when it has one, the session's life at least.
    readPage: (url) => streamer.read(url, streamer.signal),
    readGeometryPage: worldOrGeometryReader(worldRoots, streamer.readBytes, streamer.signal),
    worldRoots,
    pageRoundTripMs: streamer.roundTripMs,
    associations: inputs.associations,
    textureIndices: inputs.textureIndices,
    signal,
    maxCachedPages: cacheCap,
    onDiagnostic: diagnosticChannel.enabled ? diagnosticChannel.emit : undefined,
    preparationStep: (step) => diagnose('engine-preparation-step', step, { kind: 'preparation' }),
    diagnosticDetail: diagnosticChannel.detail,
    viewport: [canvas.width, canvas.height],
    gpuDevice: inputs.gpuDevice,
    gpuCanvas: canvas,
    sceneLighting: inputs.sceneLightingSource,
    readSceneProxy: createSceneProxyReader(metadata.proxy, inputs.base, options.pageCache, signal),
    // The reader exists as soon as the cache declares texture chains, whatever the loader read:
    // the engine reads the levels the compiler baked and regenerates none it could have read
    // instead. Its levels are held beside the pages the streamer reads (`textureLevels`).
    readTextureLevel: createTextureLevelReader(
      metadata,
      inputs.base,
      streamer.textureLevels,
      signal,
    ),
    ...lights,
    frameBudget: inputs.frameBudget,
  }
}

/** Prepares `engine`; a failure is diagnosed and thrown, the engine released — awaited when the
 *  session or the engine cancelled it (nothing of it outlives the session), not otherwise. */
async function prepareEngine(session: ExplorerSession, engine: Engine) {
  const { scope, signal, diagnose } = session
  const preparation = { kind: 'preparation' as const, scope }
  diagnose('engine-preparation-start', 'Engine preparation started', { ...preparation })
  try {
    await engine.prepare()
  } catch (error) {
    // A release that fails is diagnosed; what went wrong before it still goes on.
    const release = async () => {
      try {
        await engine.dispose()
      } catch (disposeError) {
        diagnose('engine-dispose-error', 'Engine release failed', {
          kind: 'error',
          error: String(disposeError),
          scope,
        })
      }
    }
    // Cancelled — the session closed, or the engine did: nothing failed. An abort neither asked
    // for is a failure like any other.
    if (isCancelled(engine.signal ?? signal)) {
      await release()
      throw error
    }
    diagnose('engine-preparation-error', 'Engine preparation failed', {
      kind: 'error',
      error: String(error),
      scope,
    })
    void release() // the failure is thrown without waiting for the release
    throw error
  }
  diagnose('engine-preparation-complete', 'Engine preparation completed', { ...preparation })
}

/** Builds and prepares the session's one engine on the context `engineContext` makes. */
export async function prepareExplorerEngine(session: ExplorerSession, inputs: Inputs) {
  const { indices, streamer, preload } = inputs.pageSources
  const context = engineContext(session, inputs, await sessionLights(session, inputs.base))
  const engine = inputs.factory(context)
  await prepareEngine(session, engine)
  if (preload !== 'all') indices.clear()
  // The engine's host tables, which follow the view, and the world roots the models hold come out
  // of the cached pages' CPU share.
  const roots = inputs.worldRoots
  streamer.reserve(() =>
    roots.reduce((bytes, held) => bytes + held.bytes(), engine.hostTableBytes()),
  )
  return { viewport: context.viewport!, context, engine }
}
