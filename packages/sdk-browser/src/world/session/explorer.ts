import { explorerSwitch } from '../../../../sdk-core/src/runtime/explorerSwitches.ts'
import { resolveExplorerTarget, type MeasuredWorldTarget } from './target.ts'
import { interactiveOptions } from './interactiveOptions.ts'
import { startInteractiveExplorer } from './interactive.ts'
import { releaseOwned } from './lifecycle.ts'
import { loadExplorerManifest } from './manifest.ts'
import type { MeasuredWorldOptions } from '../../engine/types.ts'
import { createExplorerSession, type ExplorerSession } from './session.ts'
import { prepareExplorer, type ExplorerResources, type ExplorerSource } from './prepare.ts'
import { createSessionRuntime, type SessionRuntime } from '../render/sessionRuntime.ts'
import { createExplorerApi } from '../api/api.ts'
import { referenceCapture, referenceOptions } from '../../frame/referenceMode.ts'
import { referenceTilesCapture } from '../../frame/referenceTiles.ts'
import type { EngineProfiler } from '../../diagnostic/telemetry.ts'

type Opened = Awaited<ReturnType<typeof createExplorerSession>>
type Reference = ReturnType<typeof referenceOptions>['reference']

/** The frame report on `window.__trillion3d`, a debug handle of the page's console. */
function exposeProfiler(profiler: EngineProfiler) {
  if (typeof window === 'undefined') return
  ;(window as unknown as { __trillion3d: unknown }).__trillion3d = {
    profiler,
    getReport: () => profiler.getReport(),
    printReport: () => profiler.printReport(),
    enableAutoLog: (sec = 2) => profiler.startAutoLog(sec),
    disableAutoLog: () => profiler.stopAutoLog(),
  }
}

/** The public session over its runtime: the API, its own loop when interactive, and the captures
 *  of reference mode. */
function sessionApi(
  runtime: SessionRuntime,
  inputs: {
    opened: Opened
    original: MeasuredWorldOptions
    reference: Reference
    prepared: Awaited<ReturnType<typeof prepareExplorer>>
    preparationStart: number
    source?: ExplorerSource
  },
) {
  const { opened, original, reference, prepared, source } = inputs
  const explorer = createExplorerApi({
    ...runtime,
    capabilities: prepared.capabilities,
    preparationMs: performance.now() - inputs.preparationStart,
    moveNamed: source?.moveNamed,
  })
  // A change asks the session's own loop for a frame; without one, the page draws (`render`)
  // and a change asks nothing.
  const invalidate = explorerSwitch(runtime.options, 'interactive')
    ? startInteractiveExplorer(explorer, runtime, original, opened)
    : () => {}
  // Reference mode reads the resolved image; `renderViews` keeps the drawn one, at canvas size.
  const shadowBias = () => runtime.engine.metrics().shadowResolutionBias
  const capture = referenceCapture(explorer.capture, reference, shadowBias)
  // The reference image itself, captured tile by tile at a heavy supersampling
  // (`referenceTiles.ts`), box-filtered and assembled in linear light.
  const captureReference = reference
    ? referenceTilesCapture(
        (width, height) => explorer.captureView(width, height),
        (tile) => {
          ;(explorer.camera as { viewTile?: unknown }).viewTile = tile
        },
        reference.tiles,
        shadowBias,
      )
    : null
  return Object.assign(explorer, { invalidate, capture, reference, captureReference })
}

/** The manifest the session opens on: the one handed in, or the one `manifestUrl` points at. */
function readManifest(opened: Opened, manifestUrl: string, source?: ExplorerSource) {
  if (source) return { ...source, loadedBase: source.base }
  const { scope, signal, diagnose, diagnosticChannel } = opened
  return loadExplorerManifest(manifestUrl, scope, signal, diagnose, diagnosticChannel).catch(
    (error: unknown) => {
      opened.opening.done()
      throw error
    },
  )
}

/** What an opening that failed releases: the runtime's disposal everything; before it exists,
 *  what the opening holds — the engine, the source and the device —, and its channel. */
function failedOpening(
  session: ExplorerSession,
  resources: ExplorerResources,
  runtime: SessionRuntime | undefined,
) {
  if (runtime) return runtime.dispose()
  resources.engine?.dispose()
  resources.streamer?.dispose()
  releaseOwned(session, resources)
  session.diagnosticChannel.flushSync()
  session.diagnosticChannel.close()
}

/** Opens a session on `target`. `source` hands in a scene the caller already holds — manifest and
 *  graph — in place of the one `manifestUrl` names: what a world built in code is drawn from. */
export async function openMeasuredWorld(
  target: MeasuredWorldTarget,
  original: MeasuredWorldOptions,
  source?: ExplorerSource,
) {
  const canvas = resolveExplorerTarget(target)
  const { options, reference } = referenceOptions(interactiveOptions(canvas, original))
  options.signal?.throwIfAborted()
  const lifetime = explorerSwitch(options, 'interactive') ? new AbortController() : undefined
  if (lifetime)
    options.signal = options.signal
      ? AbortSignal.any([options.signal, lifetime.signal])
      : lifetime.signal
  const manifestUrl = source?.manifestUrl ?? options.manifestUrl
  const opened = createExplorerSession(options, manifestUrl)
  const { diagnosticChannel, diagnose, preparationStart, signal, scope, progress } = opened
  progress('manifest', 0, 1, 'Reading the cache')
  const {
    metadata,
    metadataUrl,
    loadedBase: base,
  } = await readManifest(opened, manifestUrl, source)
  const resources: ExplorerResources = {}
  const session: ExplorerSession = {
    ...{ canvas, options, metadata, scope, signal, diagnosticChannel },
    ...{ emit: opened.emit, diagnose },
    // A scene handed in is the caller's, and so is the canvas context it is drawn on.
    callerOwned: source !== undefined,
  }
  let runtime: SessionRuntime | undefined
  try {
    const prepared = await prepareExplorer(session, {
      ...{ manifestUrl, metadataUrl, base, resources, progress },
      scene: source?.scene,
      placeCamera: source?.placeCamera,
    })
    runtime = createSessionRuntime(session, { prepared, resources, engine: prepared.engine })
    if (lifetime) runtime.ownedControls.push({ dispose: () => lifetime.abort() })
    progress('ready', 1, 1, 'MeasuredWorld ready')
    exposeProfiler(runtime.profiler)
    return sessionApi(runtime, { opened, original, reference, prepared, preparationStart, source })
  } catch (error) {
    diagnose('error', 'MeasuredWorld preparation failed', {
      kind: 'error',
      error: String(error),
      scope,
      manifestUrl,
    })
    failedOpening(session, resources, runtime)
    throw error
  } finally {
    opened.opening.done()
  }
}
export type MeasuredWorld = Awaited<ReturnType<typeof openMeasuredWorld>>
