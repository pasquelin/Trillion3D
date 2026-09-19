import { disposeSource } from './explorerDisposeSource.ts';
import { EngineError } from '../sdk-core/index.ts';
import { loadExplorerManifest } from './explorerManifest.ts';
import type { RenderBackend, ExplorerOptions } from './backendTypes.ts';
import { createExplorerSession, type ExplorerSession } from './explorerSession.ts';
import { prepareExplorer, type ExplorerResources } from './explorerPrepare.ts';
import { createExplorerHostRuntime } from './explorerHostRuntime.ts';
import { createExplorerApi } from './explorerApi.ts';

export async function createExplorer(canvas: HTMLCanvasElement, options: ExplorerOptions) {
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
    return createExplorerApi({
      ...runtime,
      capabilities: prepared.capabilities,
      preparationMs: performance.now() - preparationStart,
    });
  } catch (error) {
    diagnose('error', 'Explorer preparation failed', {
      kind: 'error',
      error: String(error),
      scope,
      manifestUrl,
    });
    backends.forEach((b) => b.dispose());
    if (resources.source) disposeSource(resources.source);
    resources.renderer?.dispose();
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
