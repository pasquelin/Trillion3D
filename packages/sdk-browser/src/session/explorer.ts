import { signalWith } from '../../../sdk-core/src/runtime/followSignal.ts'
import { msSince } from '../diagnostic/stopwatch.ts'
import { explorerSwitch } from '../../../sdk-core/src/runtime/explorerSwitches.ts'
import { resolveExplorerTarget, type MeasuredWorldTarget } from './target.ts'
import { interactiveOptions } from './interactiveOptions.ts'
import { startInteractiveExplorer } from './interactive.ts'
import { canvasFollower } from './interactiveResize.ts'
import { releaseHeld } from './lifecycle.ts'
import { loadExplorerManifest } from './manifest.ts'
import type { MeasuredWorldOptions } from './options.ts'
import { createExplorerSession, type ExplorerSession } from './session.ts'
import {
  prepareExplorer,
  type ExplorerResources,
  type ExplorerSource,
  type PreparedExplorer,
} from './prepare.ts'
import { createSessionRuntime, type SessionRuntime } from '../frame/schedule/sessionRuntime.ts'
import { createExplorerApi } from '../api/api.ts'
import { referenceOptions } from '../frame/reference/referenceMode.ts'
import { referenceTilesCapture } from '../frame/reference/referenceTiles.ts'
import type { EngineProfiler } from '../diagnostic/telemetry.ts'

type Opened = Awaited<ReturnType<typeof createExplorerSession>>
type Reference = ReturnType<typeof referenceOptions>['reference']

/** The session's one profiler on `window.__trillion3d`, a debug handle of the page's console:
 *  `__trillion3d.profiler.printReport()`, `.startAutoLog(2)`. */
function exposeProfiler(profiler: EngineProfiler) {
  if (typeof window === 'undefined') return
  Object.assign(window, { __trillion3d: { profiler } })
}

/** The public session over its runtime: the API, its own loop when interactive, and the captures
 *  of reference mode. */
function sessionApi(
  runtime: SessionRuntime,
  inputs: {
    opened: Opened
    original: MeasuredWorldOptions
    reference: Reference
    prepared: PreparedExplorer
    preparationStart: number
    source?: ExplorerSource
  },
) {
  const { opened, original, reference, prepared, source } = inputs
  const explorer = createExplorerApi({
    ...runtime,
    capabilities: prepared.capabilities,
    preparationMs: msSince(inputs.preparationStart),
    moveNamed: source?.moveNamed,
  })
  // The canvas's size, followed by the session's own loop from its listeners, or before each
  // frame by a page that leads (`canvasFollower`). A change asks the session's own loop for a
  // frame; without one, the page draws (`render`) and a change asks nothing.
  const followCanvas = canvasFollower(runtime, explorer, original)
  const invalidate = explorerSwitch(runtime.options, 'interactive')
    ? startInteractiveExplorer(explorer, runtime, original, opened, followCanvas)
    : () => {}
  // In reference mode the capture is the reference image itself: tile by tile at a heavy
  // supersampling (`referenceTiles.ts`), box-filtered and assembled in linear light, refused
  // while the shadows draw coarser than they ask. Outside it, the drawn frame.
  const shadowBias = () => runtime.engine.metrics().shadowResolutionBias
  const capture = reference
    ? referenceTilesCapture(
        (width, height) => explorer.captureView(width, height),
        (tile) => {
          ;(explorer.camera as { viewTile?: unknown }).viewTile = tile
        },
        reference.tiles,
        shadowBias,
      )
    : explorer.capture
  return Object.assign(explorer, {
    ...{ invalidate, followCanvas, capture, reference },
  })
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
 *  what the opening holds (`releaseHeld`). */
function failedOpening(
  session: ExplorerSession,
  resources: ExplorerResources,
  runtime: SessionRuntime | undefined,
) {
  if (runtime) return runtime.dispose()
  resources.opening?.abort()
  releaseHeld(session, resources)
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
  if (lifetime) options.signal = signalWith(lifetime.signal, options.signal)
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
