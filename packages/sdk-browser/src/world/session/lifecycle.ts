import { awaitBackendPages } from '../../backend/awaitBackendPages.ts';
import { decodePageOffThread, releasePageDecoders } from '../../page/decode/host.ts';
import { releasePageIntegration } from '../../page/integration/host.ts';
import { disposeSource } from './disposeSource.ts';
import { retainVisiblePages } from '../../page/retainVisiblePages.ts';
import type { BackendContext, RenderBackend } from '../../backend/types.ts';
import type { HostCamera } from '../../camera/world.ts';
import type { createExplorerHostState, ExplorerHostState } from '../render/hostState.ts';
import type { ExplorerSession } from './session.ts';
import type { createExplorerStreaming } from '../scene/streaming.ts';
import type { createPageStreamer } from '../../streaming/pageStreamer.ts';
import type { EngineProfiler } from '../../diagnostic/telemetry.ts';
import type { WebglSurface } from '../../webgl/core/surface.ts';
import type { JobProgress } from '../../../../sdk-core/src/runtime/jobs.ts';

/** How `awaitPages` waits: with or without a picture, and who hears the pages land. */
type PageWait = { image?: boolean; onProgress?: (event: JobProgress) => void };

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

/** Frees what a session owns: the scene source and the canvas context unless the caller holds
 *  them, the device unless the caller handed it in. */
export function releaseOwned(
  session: ExplorerSession,
  owned: { source?: BackendContext['source']; webglSurface?: WebglSurface; gpuDevice?: GPUDevice },
) {
  if (owned.source && !session.callerOwned) disposeSource(owned.source);
  owned.webglSurface?.dispose(session.callerOwned);
  try {
    // A device the caller handed in is the caller's to destroy.
    if (owned.gpuDevice !== session.options.gpuDevice) owned.gpuDevice?.destroy();
  } catch {
    /* Device may already be lost. */
  }
}

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
    diagnose('dispose-start', 'MeasuredWorld disposal started', {
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
    releaseOwned(session, { source, webglSurface, gpuDevice });
    diagnose('dispose-complete', 'MeasuredWorld disposal completed', { kind: 'lifecycle', scope });
    diagnosticChannel.flushSync();
    diagnosticChannel.close();
  };
  const flush = async () => {
    check();
    if (streaming.promise) await streaming.promise;
    for (const backend of backends) await backend.flush?.();
    await diagnosticChannel.flush();
  };
  /** The pages the view reads, made resident; `image: false` takes no picture of them.
   *  `onProgress` hears `pages`: how many of those it lacked are resident, the last event once
   *  they all are (`completed === total`). */
  const awaitPages = async (options: PageWait = {}) => {
    const { onProgress, ...wait } = options;
    const pages = { completed: 0, total: 0 };
    const report = (message: string) => onProgress?.({ phase: 'pages', ...pages, message });
    check();
    if (streaming.promise) await streaming.promise;
    for (const backend of backends) {
      await awaitBackendPages(
        backend,
        camera,
        async (missing) => {
          const before = { ...pages };
          await streamer.request(missing, {
            onPage: (resident, requested) => {
              pages.completed = before.completed + resident;
              pages.total = before.total + requested;
              report(`${resident} of ${requested} pages the view reads`);
            },
          });
          for (const url of missing) {
            if (geometryUrls.has(url)) {
              const bytes = streamer.getBytes(url);
              if (bytes) backend.acceptGeometryPage?.(url, await decodePageOffThread(bytes));
            } else {
              const array = streamer.get(url);
              if (array) backend.acceptPage?.(url, array);
            }
          }
        },
        wait,
      );
      retainVisiblePages(backend, streamer);
    }
    report('The pages the view reads are resident');
    state.loaded = streamer.stats().loaded;
    state.pageBytesRead = streamer.stats().bytesRead;
  };
  return { dispose, flush, awaitPages };
}
