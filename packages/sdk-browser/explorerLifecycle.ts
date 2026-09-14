import * as THREE from 'three';
import type { AssetScope } from '../sdk-core/index.ts';
import { awaitBackendPages } from './awaitBackendPages.ts';
import { decodeGeometryPage } from './geometryPage.ts';
import { disposeSource } from './explorerDisposeSource.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { createComparisonCompositor } from './comparison.ts';
import type { createDiagnosticChannel } from './diagnosticChannel.ts';
import type { createExplorerStreaming } from './explorerStreaming.ts';
import type { createPageStreamer } from './streamingPages.ts';
import type { EngineProfiler } from './telemetry.ts';

type Inputs = {
  check: () => void;
  state: () => {
    disposed: boolean;
    active: RenderBackend;
    left?: THREE.WebGLRenderTarget;
    right?: THREE.WebGLRenderTarget;
    gpuDevice?: GPUDevice;
  };
  setDisposed: () => void;
  setPageStats: (loaded: number, bytesRead: number) => void;
  scope: AssetScope;
  diagnose: (phase: string, message: string, context?: Record<string, unknown>) => void;
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>;
  profiler: EngineProfiler;
  hostedControls: { dispose(): void }[];
  disposeTargets: () => void;
  compositor?: ReturnType<typeof createComparisonCompositor>;
  streamer: ReturnType<typeof createPageStreamer>;
  streaming: ReturnType<typeof createExplorerStreaming>;
  overlays: THREE.Material[];
  backends: RenderBackend[];
  source: THREE.Object3D;
  renderer?: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  geometryUrls: Set<string>;
};

export function createExplorerLifecycle(inputs: Inputs) {
  const {
    check,
    state,
    setDisposed,
    setPageStats,
    scope,
    diagnose,
    diagnosticChannel,
    profiler,
    hostedControls,
    disposeTargets,
    compositor,
    streamer,
    streaming,
    overlays,
    backends,
    source,
    renderer,
    camera,
    geometryUrls,
  } = inputs;
  const dispose = () => {
    if (state().disposed) return;
    diagnose('dispose-start', 'Explorer disposal started', {
      kind: 'lifecycle',
      scope,
      backend: state().active.id,
    });
    diagnosticChannel.flushSync();
    setDisposed();
    profiler.dispose();
    hostedControls.splice(0).forEach((control) => {
      try {
        control.dispose();
      } catch {
        /* Hosted controls cannot block explorer teardown. */
      }
    });
    disposeTargets();
    state().left?.dispose();
    state().right?.dispose();
    compositor?.dispose();
    streamer.dispose();
    overlays.forEach((material) => material.dispose());
    backends.forEach((backend) => backend.dispose());
    disposeSource(source);
    renderer?.dispose();
    renderer?.forceContextLoss();
    try {
      state().gpuDevice?.destroy();
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
            if (bytes) backend.acceptGeometryPage?.(url, await decodeGeometryPage(bytes));
          } else {
            const array = streamer.get(url);
            if (array) backend.acceptPage?.(url, array);
          }
        }
      });
      const urls = backend.pageUrls?.();
      if (urls) streamer.retain(urls);
    }
    setPageStats(streamer.stats().loaded, streamer.stats().bytesRead);
  };
  return { dispose, flush, awaitPages };
}
