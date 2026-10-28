import { signalWith } from '../../../sdk-core/src/runtime/followSignal.ts'
import { explorerSwitch } from '../../../sdk-core/src/runtime/explorerSwitches.ts'
import { trackSettings } from '../../../sdk-core/src/contracts/settingRules.ts'
import {
  exposureCurveScaleTable,
  exposureCurveTable,
} from '../../../sdk-core/src/contracts/exposureCurveTable.ts'
import { resolveExposureMeterMask } from '../../../sdk-core/src/contracts/exposureMeterMask.ts'
import { resolveAmbientCubemap } from '../../../sdk-core/src/contracts/ambientCubemapOptions.ts'
import type { WorldRootsHold } from '../geometry/hlod/worldRoots.ts'
import { isCancelled, pixelRatioOf } from './engine/common.ts'
import { resolvedFamilies } from './engine/familySettings.ts'
import { readDistanceFields } from '../lighting/distanceField/fieldsLoad.ts'
import { readMeshCards } from '../lighting/surfaceCache/cardsLoad.ts'
import { readRayTracing } from '../lighting/rays/sceneTrace/rayTracingLoad.ts'
import { hairStrandsReader } from '../hair/strandsLoad.ts'
import {
  readVolumetricLightmap,
  type ReadLightmap,
} from '../lighting/volumetricLightmap/fileLoad.ts'
import { unmetered } from '../geometry/cluster/byteMeter.ts'
import type { MeshDistanceField } from '../../../sdk-core/src/lighting/distanceFieldFile.ts'
import type { MeshCards } from '../../../sdk-core/src/lighting/meshCardsFile.ts'
import type { RayTracing } from '../../../sdk-core/src/lighting/rayTracingFile.ts'
import { createSceneLightStore } from '../../../sdk-core/src/scene/light/store.ts'
import { createSceneFogVolumeStore } from '../../../sdk-core/src/scene/volume/store.ts'
import { createSceneLocalFogStore } from '../../../sdk-core/src/scene/localFog/store.ts'
import { createSceneHeterogeneousVolumeStore } from '../../../sdk-core/src/scene/heterogeneousVolume/store.ts'
import { sparseVolumesReader } from '../lighting/heterogeneousVolumes/sparseVolumeLoad.ts'
import { dagWarningsDiagnostic } from '../../../sdk-core/src/contracts/dagWarnings.ts'
import { createTextureCaches, type TextureCache } from '../materials/texture/textureCaches.ts'
import { resolveDiagnosticGpuVariant } from '../diagnostic/gpuVariant.ts'
import { declareImportedLights, loadImportedLights } from '../lighting/importedLights.ts'
import { lightProfileReader } from '../lighting/lightProfile/profileFile.ts'
import type { EngineContext, Engine } from './engine/types.ts'
import type { EngineFactory } from './engine/factory.ts'
import type { ExplorerPageSources } from './pageSources.ts'
import type { ExplorerSession } from './session.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'

type Inputs = {
  source: Object3D
  draws: EngineContext['draws']
  /** The caches the scene's textures come from: its own, or each model of a world. */
  textureCaches: readonly TextureCache[]
  pageSources: ExplorerPageSources
  gpuDevice?: GPUDevice
  /** What builds the session's engine: the WebGPU page raster's factory. */
  factory: EngineFactory
  /** Manifest url base: what locates the scene's own files. */
  base: string
  frameBudget?: EngineContext['frameBudget']
  /** Each model's world roots: the pinned top and the bundles its placed cells hold (#1237). */
  worldRoots: readonly WorldRootsHold[]
}

/** One light store per session, one of the objects voxelised into the fog's volume
 *  (`sceneVolumes`) and one of the local fog volumes (`sceneLocalFog`): the engine reads them and the
 *  host writes them, with the lights the
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
  return {
    sceneLights,
    importedLightIds,
    sceneVolumes: createSceneFogVolumeStore(),
    sceneLocalFog: createSceneLocalFogStore(),
    sceneHeterogeneousVolumes: createSceneHeterogeneousVolumeStore(),
  }
}

/** What the session's options hand the engine as they are. */
function optionContext(session: ExplorerSession) {
  const { options, diagnosticChannel } = session
  exposureCurveTable(options.exposureCurve) // refused at the opening when it is not a curve
  exposureCurveScaleTable(options.localExposureHighlightContrastCurve)
  exposureCurveScaleTable(options.localExposureShadowContrastCurve)
  return {
    maxResidentPages: options.maxResidentPages,
    pixelError: options.pixelError,
    pixelRatio: () => pixelRatioOf(options),
    worldClock: options.worldClock,
    maxTextureTransferBytesPerFrame: options.maxTextureTransferBytesPerFrame,
    maxTextureUploadMsPerFrame: options.maxTextureUploadMsPerFrame,
    temporalAntialiasing: options.temporalAntialiasing,
    renderScale: options.renderScale,
    maxFrameRate: options.maxFrameRate,
    effects: options.effects,
    geometryPoolBytes: options.geometryPoolBytes,
    // The settings declared by rule (`SETTING_FAMILIES`), each refused at the opening when of
    // another kind or out of range, as the world refuses them.
    ...resolvedFamilies(options),
    exposureCurve: options.exposureCurve,
    localExposureHighlightContrastCurve: options.localExposureHighlightContrastCurve,
    localExposureShadowContrastCurve: options.localExposureShadowContrastCurve,
    exposureMeterMask: resolveExposureMeterMask(options.exposureMeterMask), // refused when not a picture
    ambientCubemap: resolveAmbientCubemap(options).ambientCubemap, // refused when not a cube
    admitGpuMemory: options.admitGpuMemory,
    texturePoolBytes: options.texturePoolBytes,
    textureCompression: options.textureCompression,
    stageProfile: options.stageProfile,
    feedbackTargetAB: options.feedbackTargetAB === true,
    drawConverged: options.drawConverged === true,
    // The diagnostic variant is checked here, once: outside `trace`, it is refused.
    diagnosticGpuVariant: resolveDiagnosticGpuVariant(
      options.diagnosticGpuVariant,
      diagnosticChannel.detail,
    ),
    guides: options.guides,
    particles: options.particles,
    // Bounced light stays off unless asked: its step holds 1.1 to 1.3 ms on Emerald, above 1 ms.
    bounce: options.bounce,
  }
}

/** The context the engine is built on: the scene, the readers of the cache, the session's lights. */
function engineContext(
  session: ExplorerSession,
  inputs: Inputs,
  lights: Awaited<ReturnType<typeof sessionLights>>,
  distanceFields: MeshDistanceField[] | undefined,
  meshCards: MeshCards[] | undefined,
  rayTracing: RayTracing | undefined,
  volumetricLightmap: ReadLightmap | undefined,
): EngineContext {
  const { canvas, metadata, signal, diagnosticChannel, diagnose } = session
  const { indices, streamer, pageCache } = inputs.pageSources
  // The world roots the scene's own manifest opened ride the context; their pages, as every
  // geometry page, are slices of bundles the session's one reader serves
  // (`../geometry/hlod/worldRuns.ts`). The cut draws one world DAG: the first a model of the scene
  // holds, drawn (`WorldRootsHold.dag`).
  const worldRoots = inputs.worldRoots.find((hold) => hold.dag)
  // The caches the scene's textures come from, their levels held among the pages the streamer
  // reads, in their page cache.
  const textureCaches = createTextureCaches(pageCache, signal, streamer.numRetries)
  textureCaches.add(...inputs.textureCaches)
  // Every write of its settings is a writer's (`api/ruleApi.ts`): tracked, so a frame reads a rest once.
  return trackSettings({
    ...optionContext(session),
    source: inputs.source,
    metadata,
    indices,
    // The session's reads: the engine's own signal when it has one, the session's life at least.
    readPage: (url) => streamer.read(url, streamer.signal),
    admitPages: (pages) => streamer.admit(pages),
    onContentRefused: session.options.onContentRefused,
    readGeometryPage: (url, own, priority) =>
      streamer.readBytes(url, own ?? streamer.signal, priority),
    geometryPageFailed: streamer.failed,
    worldRoots,
    draws: inputs.draws,
    signal,
    onDiagnostic: diagnosticChannel.enabled ? diagnosticChannel.emit : undefined,
    preparationStep: (step) => diagnose('engine-preparation-step', step, { kind: 'preparation' }),
    diagnosticDetail: diagnosticChannel.detail,
    viewport: [canvas.width, canvas.height],
    gpuDevice: inputs.gpuDevice,
    gpuCanvas: canvas,
    textureCaches,
    ...lights,
    distanceFields,
    meshCards,
    rayTracing,
    hairStrandsFile: hairStrandsReader(metadata, inputs.base, signal, unmetered),
    sparseVolumesFile: sparseVolumesReader(metadata, inputs.base, signal, unmetered),
    lightProfileFile: lightProfileReader(inputs.base, signal),
    volumetricLightmapData: volumetricLightmap?.data,
    readVolumetricLightmapCell: volumetricLightmap?.readCell,
    frameBudget: inputs.frameBudget,
  })
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
  const lights = await sessionLights(session, inputs.base)
  // The sidecars the cache carries, read together: the meshes' distance fields and cards, none for a cache whose meshes built
  // none, and the primitives' acceleration structures, none for a cache whose primitives built none. One that fails stops the
  // others' reads.
  const failed = new AbortController()
  const reading = signalWith(failed.signal, session.signal)
  const [distanceFields, meshCards, rayTracing] = await Promise.all([
    readDistanceFields(
      session.metadata,
      inputs.base,
      reading,
      unmetered,
      inputs.pageSources.pageCache.readRange,
    ),
    readMeshCards(session.metadata, inputs.base, reading, unmetered),
    readRayTracing(session.metadata, inputs.base, reading, unmetered),
  ]).catch((error) => {
    failed.abort(error)
    throw error
  })
  // The scene's baked indirect light, none for a cache whose job baked none.
  const volumetricLightmap = await readVolumetricLightmap(
    session.metadata,
    inputs.base,
    session.signal,
    unmetered,
    inputs.pageSources.pageCache.readRange,
  )
  const context = engineContext(
    session,
    inputs,
    lights,
    distanceFields,
    meshCards,
    rayTracing,
    volumetricLightmap,
  )
  const engine = inputs.factory(context)
  await prepareEngine(session, engine)
  if (preload !== 'all') indices.clear()
  // The engine's host tables, which follow the view, and the world roots the models hold come out
  // of the cached pages' CPU share: reserved once prepared, then as each frame says them.
  const roots = inputs.worldRoots
  const hostBytes = () =>
    roots.reduce((bytes, held) => bytes + held.reserved(), engine.hostTableBytes())
  streamer.reserve(hostBytes())
  return { viewport: context.viewport!, context, engine, hostBytes }
}
