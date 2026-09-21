import { awaitBackendPages } from './awaitBackendPages.ts';
import { decodePageOffThread, releasePageDecoders } from './pageDecodeHost.ts';
import { releasePageIntegration } from './pageIntegrationHost.ts';
import { disposeSource } from './explorerDisposeSource.ts';
import { retainVisiblePages } from './retainVisiblePages.ts';
import type { BackendContext, RenderBackend } from './backendTypes.ts';
import type { HostCamera } from './cameraWorld.ts';
import type { createExplorerHostState, ExplorerHostState } from './explorerHostState.ts';
import type { ExplorerSession } from './explorerSession.ts';
import type { createExplorerStreaming } from './explorerStreaming.ts';
import type { createPageStreamer } from './streamingPages.ts';
import type { EngineProfiler } from './telemetry.ts';
import type { WebglSurface } from './webglSurface.ts';

type Inputs = {
  check: () => void;
  state: ExplorerHostState;
  gpuDevice?: GPUDevice;
  profiler: EngineProfiler;
  hostedControls: { dispose(): void }[];
  /** The composer and the compositor: programs and copies on the engine's context, released
   *  before the surface that carries them. */
  disposeComposition: () => void;
  streamer: ReturnType<typeof createPageStreamer>;
  streaming: ReturnType<typeof createExplorerStreaming>;
  overlays: ReturnType<typeof createExplorerHostState>['overlays'];
  backends: RenderBackend[];
  source: BackendContext['source'];
  webglSurface?: WebglSurface;
  camera: HostCamera;
  geometryUrls: Set<string>;
};

export function createExplorerLifecycle(session: ExplorerSession, inputs: Inputs) {
  const { scope, diagnosticChannel, diagnose } = session;
  const {
    check,
    state,
    gpuDevice,
    profiler,
    hostedControls,
    disposeComposition,
    streamer,
    streaming,
    overlays,
    backends,
    source,
    webglSurface,
    camera,
    geometryUrls,
  } = inputs;
  const dispose = () => {
    if (state.disposed) return;
    diagnose('dispose-start', 'Explorer disposal started', {
      kind: 'lifecycle',
      scope,
      backend: state.active.id,
    });
    diagnosticChannel.flushSync();
    state.disposed = true;
    profiler.dispose();
    hostedControls.splice(0).forEach((control) => {
      try {
        control.dispose();
      } catch {
        /* Hosted controls cannot block explorer teardown. */
      }
    });
    state.measurementTarget?.dispose();
    state.pairTargetA?.dispose();
    state.pairTargetB?.dispose();
    state.measurementTarget = state.pairTargetA = state.pairTargetB = undefined;
    disposeComposition();
    streaming.backgroundFetchController?.abort();
    streamer.dispose();
    releasePageDecoders();
    releasePageIntegration();
    overlays.forEach((material) => material.dispose());
    backends.forEach((backend) => backend.dispose());
    disposeSource(source);
    webglSurface?.dispose();
    try {
      gpuDevice?.destroy();
    } catch {
      /* Device may already be lost. */
    }
    diagnose('dispose-complete', 'Explorer disposal completed', { kind: 'lifecycle', scope });
    diagnosticChannel.flushSync();
    diagnosticChannel.close();
  };
  const flush = async () => {
    check();
    if (streaming.promise) await streaming.promise;
    for (const backend of backends) await backend.flush?.();
    await diagnosticChannel.flush();
  };
  const awaitPages = async () => {
    check();
    if (streaming.promise) await streaming.promise;
    for (const backend of backends) {
      await awaitBackendPages(backend, camera, async (missing) => {
        await streamer.request(missing);
        for (const url of missing) {
          if (geometryUrls.has(url)) {
            const bytes = streamer.getBytes(url);
            if (bytes) backend.acceptGeometryPage?.(url, await decodePageOffThread(bytes));
          } else {
            const array = streamer.get(url);
            if (array) backend.acceptPage?.(url, array);
          }
        }
      });
      retainVisiblePages(backend, streamer);
    }
    state.loaded = streamer.stats().loaded;
    state.pageBytesRead = streamer.stats().bytesRead;
  };
  return { dispose, flush, awaitPages };
}
