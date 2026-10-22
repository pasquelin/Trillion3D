import { explorerSwitch } from '../../../sdk-core/src/runtime/explorerSwitches.ts'
import { resolveSettings } from '../../../sdk-core/src/contracts/settingRules.ts'
import { RASTER_RULES } from '../../../sdk-core/src/contracts/rasterOptions.ts'
import { STREAMING_RULES } from '../../../sdk-core/src/contracts/streamingOptions.ts'
import { WORLD_STREAMING_RULES } from '../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import { CUT_RULES } from '../../../sdk-core/src/contracts/cutOptions.ts'
import { ANIMATION_RULES } from '../../../sdk-core/src/contracts/animationOptions.ts'
import { EXPOSURE_RULES } from '../../../sdk-core/src/contracts/exposureOptions.ts'
import { TEMPORAL_RULES } from '../../../sdk-core/src/contracts/temporalOptions.ts'
import { SHADOW_RULES } from '../../../sdk-core/src/contracts/shadowOptions.ts'
import { MOTION_BLUR_RULES } from '../../../sdk-core/src/contracts/motionBlurOptions.ts'
import { DEPTH_OF_FIELD_RULES } from '../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { BLOOM_RULES } from '../../../sdk-core/src/contracts/bloomRules.ts'
import { GAUSSIAN_BLUR_RULES } from '../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import { FILM_RULES } from '../../../sdk-core/src/contracts/filmOptions.ts'
import { SCREEN_PROBE_RULES } from '../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { REFLECTION_RULES } from '../../../sdk-core/src/contracts/reflectionOptions.ts'
import { AMBIENT_OCCLUSION_RULES } from '../../../sdk-core/src/contracts/ambientOcclusionOptions.ts'
import { VOLUMETRIC_FOG_RULES } from '../../../sdk-core/src/contracts/volumetricFogOptions.ts'
import { TESSELLATION_RULES } from '../../../sdk-core/src/contracts/tessellationOptions.ts'
import { SHADING_RULES } from '../../../sdk-core/src/contracts/shadingOptions.ts'
import type { WorldRootsHold } from '../geometry/hlod/worldRoots.ts'
import { isCancelled, pixelRatioOf } from './engine/common.ts'
import { createSceneLightStore } from '../../../sdk-core/src/scene/light/store.ts'
import { dagWarningsDiagnostic } from '../../../sdk-core/src/contracts/dagWarnings.ts'
import { createSceneProxyReader } from '../scene/proxyLoad.ts'
import { createTextureCaches, type TextureCache } from '../materials/texture/textureCaches.ts'
import { resolveDiagnosticGpuVariant } from '../diagnostic/gpuVariant.ts'
import { declareImportedLights, loadImportedLights } from '../lighting/importedLights.ts'
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
    pixelError: options.pixelError,
    pixelRatio: () => pixelRatioOf(options),
    maxTextureTransferBytesPerFrame: options.maxTextureTransferBytesPerFrame,
    maxTextureUploadMsPerFrame: options.maxTextureUploadMsPerFrame,
    temporalAntialiasing: options.temporalAntialiasing,
    renderScale: options.renderScale,
    maxFrameRate: options.maxFrameRate,
    effects: options.effects,
    geometryPoolBytes: options.geometryPoolBytes,
    // The settings declared by rule, each refused at the opening when of another kind or out of
    // range, as the world refuses them.
    ...resolveSettings(RASTER_RULES, options),
    ...resolveSettings(STREAMING_RULES, options),
    ...resolveSettings(WORLD_STREAMING_RULES, options),
    ...resolveSettings(CUT_RULES, options),
    ...resolveSettings(ANIMATION_RULES, options),
    ...resolveSettings(SHADING_RULES, options),
    ...resolveSettings(EXPOSURE_RULES, options),
    ...resolveSettings(TEMPORAL_RULES, options),
    ...resolveSettings(SHADOW_RULES, options),
    ...resolveSettings(MOTION_BLUR_RULES, options),
    ...resolveSettings(DEPTH_OF_FIELD_RULES, options),
    ...resolveSettings(BLOOM_RULES, options),
    ...resolveSettings(GAUSSIAN_BLUR_RULES, options),
    ...resolveSettings(FILM_RULES, options),
    ...resolveSettings(SCREEN_PROBE_RULES, options),
    ...resolveSettings(REFLECTION_RULES, options),
    ...resolveSettings(AMBIENT_OCCLUSION_RULES, options),
    ...resolveSettings(VOLUMETRIC_FOG_RULES, options),
    ...resolveSettings(TESSELLATION_RULES, options),
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
    bounceProbesPerFrame: options.bounceProbesPerFrame,
  }
}

/** The context the engine is built on: the scene, the readers of the cache, the session's lights. */
function engineContext(
  session: ExplorerSession,
  inputs: Inputs,
  lights: Awaited<ReturnType<typeof sessionLights>>,
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
  const textureCaches = createTextureCaches(pageCache, signal)
  textureCaches.add(...inputs.textureCaches)
  return {
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
    readSceneProxy: createSceneProxyReader(metadata.proxy, inputs.base, pageCache, signal),
    textureCaches,
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
  // of the cached pages' CPU share: reserved once prepared, then as each frame says them.
  const roots = inputs.worldRoots
  const hostBytes = () =>
    roots.reduce((bytes, held) => bytes + held.reserved(), engine.hostTableBytes())
  streamer.reserve(hostBytes())
  return { viewport: context.viewport!, context, engine, hostBytes }
}
