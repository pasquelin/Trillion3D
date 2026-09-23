import { resolveExplorerTarget, type MeasuredWorldTarget } from './target.ts';
import { interactiveOptions } from './interactiveOptions.ts';
import { startInteractiveExplorer } from './interactive.ts';
import { releaseOwned } from './lifecycle.ts';
import { loadExplorerManifest } from './manifest.ts';
import type { RenderBackend, MeasuredWorldOptions } from '../../backend/types.ts';
import { createExplorerSession, type ExplorerSession } from './session.ts';
import { prepareExplorer, type ExplorerResources, type ExplorerSource } from './prepare.ts';
import { createExplorerHostRuntime } from '../render/hostRuntime.ts';
import { createExplorerApi } from '../api/api.ts';

/** Opens a session on `target`. `source` hands in a scene the caller already holds — manifest and
 *  graph — in place of the one `manifestUrl` names: what a world built in code is drawn from. */
export async function openMeasuredWorld(
  target: MeasuredWorldTarget,
  original: MeasuredWorldOptions,
  source?: ExplorerSource,
) {
  const canvas = resolveExplorerTarget(target);
  const options = interactiveOptions(canvas, original);
  options.signal?.throwIfAborted();
  const lifetime = options.interactive ? new AbortController() : undefined;
  if (lifetime)
    options.signal = options.signal
      ? AbortSignal.any([options.signal, lifetime.signal])
      : lifetime.signal;
  const { diagnosticChannel, emit, diagnose, preparationStart, signal, scope, progress } =
    createExplorerSession(options);
  progress('manifest', 0, 1, 'Reading the cache');
  const manifestUrl = source?.manifestUrl ?? options.manifestUrl;
  const {
    metadata,
    metadataUrl,
    loadedBase: base,
  } = source
    ? { ...source, loadedBase: source.base }
    : await loadExplorerManifest(manifestUrl, scope, signal, diagnose, diagnosticChannel);
  const resources: ExplorerResources = {};
  const backends: RenderBackend[] = [];
  const session: ExplorerSession = {
    canvas,
    options,
    metadata,
    scope,
    signal,
    diagnosticChannel,
    emit,
    diagnose,
    // A scene handed in is the caller's, and so is the canvas context it is drawn on.
    callerOwned: source !== undefined,
  };
  let disposeRuntime: (() => void) | undefined;
  try {
    const prepared = await prepareExplorer(session, {
      manifestUrl,
      metadataUrl,
      base,
      backends,
      resources,
      progress,
      scene: source?.scene,
    });
    const runtime = createExplorerHostRuntime(session, { prepared, resources, backends });
    disposeRuntime = runtime.dispose;
    if (lifetime) runtime.hostedControls.push({ dispose: () => lifetime.abort() });
    const { profiler } = runtime;
    progress('ready', 1, 1, 'MeasuredWorld ready');
    if (typeof window !== 'undefined') {
      (window as unknown as { __webGeometry: unknown }).__webGeometry = {
        profiler,
        getReport: () => profiler.getReport(),
        printReport: () => profiler.printReport(),
        enableAutoLog: (sec = 2) => profiler.startAutoLog(sec),
        disableAutoLog: () => profiler.stopAutoLog(),
      };
    }
    const explorer = createExplorerApi({
      ...runtime,
      capabilities: prepared.capabilities,
      preparationMs: performance.now() - preparationStart,
    });
    const invalidate = options.interactive
      ? startInteractiveExplorer(explorer, runtime, original, { emit, diagnose })
      : () => {
          explorer.render();
        };
    return Object.assign(explorer, { invalidate });
  } catch (error) {
    diagnose('error', 'MeasuredWorld preparation failed', {
      kind: 'error',
      error: String(error),
      scope,
      manifestUrl,
    });
    if (disposeRuntime) {
      disposeRuntime();
      throw error;
    }
    backends.forEach((b) => b.dispose());
    releaseOwned(session, resources);
    diagnosticChannel.flushSync();
    diagnosticChannel.close();
    throw error;
  }
}
export type MeasuredWorld = Awaited<ReturnType<typeof openMeasuredWorld>>;
