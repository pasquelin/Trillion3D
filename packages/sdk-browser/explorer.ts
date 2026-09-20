import { resolveExplorerTarget, type ExplorerTarget } from './explorerTarget.ts';
import { interactiveOptions } from './explorerInteractiveOptions.ts';
import { startInteractiveExplorer } from './explorerInteractive.ts';
import { disposeSource } from './explorerDisposeSource.ts';
import { EngineError } from '../sdk-core/index.ts';
import { loadExplorerManifest } from './explorerManifest.ts';
import type { RenderBackend, ExplorerOptions } from './backendTypes.ts';
import { createExplorerSession, type ExplorerSession } from './explorerSession.ts';
import { prepareExplorer, type ExplorerResources } from './explorerPrepare.ts';
import { createExplorerHostRuntime } from './explorerHostRuntime.ts';
import { createExplorerApi } from './explorerApi.ts';

export async function createExplorer(target: ExplorerTarget, original: ExplorerOptions) {
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
  const { manifestUrl } = options;
  const { metadata, metadataUrl, loadedBase } = await loadExplorerManifest(
    manifestUrl,
    scope,
    signal,
    diagnose,
    diagnosticChannel,
  );
  const autonomous = options.autonomousGeometry === true;
  if (autonomous && (!metadata.autonomousScene || options.backends))
    throw new EngineError(
      'AUTONOMOUS_SCENE_UNAVAILABLE',
      'Autonomous geometry requires a prepared static scene and the autonomous backend',
    );
  const base = loadedBase;
  const sceneFile = autonomous ? metadata.autonomousScene! : 'source.gltf';
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
  };
  let disposeRuntime: (() => void) | undefined;
  try {
    const prepared = await prepareExplorer(session, {
      manifestUrl,
      metadataUrl,
      sceneFile,
      base,
      autonomous,
      backends,
      resources,
      progress,
    });
    const runtime = createExplorerHostRuntime(session, { prepared, resources, backends });
    disposeRuntime = runtime.dispose;
    if (lifetime) runtime.hostedControls.push({ dispose: () => lifetime.abort() });
    const { profiler } = runtime;
    progress('ready', 1, 1, 'Explorer ready');
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
    diagnose('error', 'Explorer preparation failed', {
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
    if (resources.source) disposeSource(resources.source);
    resources.renderer?.dispose();
    resources.webglSurface?.dispose();
    try {
      resources.gpuDevice?.destroy();
    } catch {
      /* Device may already be lost. */
    }
    diagnosticChannel.flushSync();
    diagnosticChannel.close();
    throw error;
  }
}
export type Explorer = Awaited<ReturnType<typeof createExplorer>>;
