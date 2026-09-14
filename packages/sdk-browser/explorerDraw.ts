import * as THREE from 'three';
import { EngineError, type AssetScope, type RuntimeEvent } from '../sdk-core/index.ts';
import { PREFETCH_BATCH, PREFETCH_INTERVAL_MS } from './backendCommon.ts';
import { PRIORITY_PREFETCH } from './streamingPriority.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { createPageStreamer } from './streamingPages.ts';
import type { createExplorerStreaming } from './explorerStreaming.ts';

type Inputs = {
  camera: THREE.PerspectiveCamera;
  geometryUrls: Set<string>;
  streamer: ReturnType<typeof createPageStreamer>;
  streaming: ReturnType<typeof createExplorerStreaming>;
  directGpu: boolean;
  renderer: THREE.WebGLRenderer;
  baseline: RenderBackend;
  scope: AssetScope;
  state: () => { measuring: boolean };
  onFallback: (reason: string) => void;
  emit: (event: RuntimeEvent) => void;
  diagnose: (phase: string, message: string, context?: Record<string, unknown>) => void;
};

export function createExplorerDraw(inputs: Inputs) {
  const {
    camera,
    geometryUrls,
    streamer,
    streaming,
    directGpu,
    renderer: ownedRenderer,
    baseline,
    scope,
    state,
    onFallback,
    emit,
    diagnose,
  } = inputs;
  const drawBackend = (backend: RenderBackend, target: THREE.WebGLRenderTarget | null) => {
    const { measuring } = state();
    const steps = backend as {
      cpuStep?: (index: number, ms: number) => void;
      cpuFrameEnd?: () => void;
    };
    backend.render(camera);
    const renderEnd = performance.now();
    const missing = backend.pendingUrls?.() ?? [];
    if (missing.length > 0) {
      streaming.queueCached(backend, missing);
      const needFetch = missing.filter(
        (url) =>
          (geometryUrls.has(url) || !streamer.has(url)) &&
          !streamer.loading(url) &&
          !streamer.failed(url) &&
          !streaming.decodeFailures.has(url),
      );
      if (needFetch.length > 0) {
        if (!measuring && !streaming.promise) streaming.startFetch(needFetch);
        else if (!measuring && streaming.promise) {
          for (const url of needFetch)
            if (!streaming.queuedFetch.includes(url)) streaming.queuedFetch.push(url);
          streaming.backgroundFetchController?.abort(
            new DOMException('Camera request superseded', 'AbortError'),
          );
        }
      }
    } else if (
      !measuring &&
      !streaming.promise &&
      !streaming.queuedFetch.length &&
      performance.now() - streaming.lastPrefetch > PREFETCH_INTERVAL_MS &&
      streamer.stats().loading === 0
    ) {
      // The network is idle and nothing visible is missing: pull the ring around the cut ahead of the
      // camera, at a priority any visible request outranks. A second selection pass costs as much as
      // the first, so it runs on a timer, never on every frame.
      streaming.lastPrefetch = performance.now();
      const ring = backend.prefetchUrls?.();
      if (ring && ring.length) {
        const cold = ring
          .filter((url) => !streamer.has(url) && !streamer.loading(url) && !streamer.failed(url))
          .slice(0, PREFETCH_BATCH);
        if (cold.length) streaming.startFetch(cold, PRIORITY_PREFETCH);
      }
    }
    const pendingEnd = performance.now();
    const visibleUrls = backend.pageUrls?.();
    if (visibleUrls) streamer.retain(visibleUrls);
    const retainEnd = performance.now();
    steps.cpuStep?.(5, pendingEnd - renderEnd);
    steps.cpuStep?.(6, retainEnd - pendingEnd);
    if (directGpu) {
      if (backend.overBudget)
        throw new EngineError('PAGE_BUDGET', 'Visible pages exceed the resident budget');
      return;
    }
    ownedRenderer.setRenderTarget(target);
    if (backend.overBudget && backend !== baseline) {
      if (measuring)
        throw new EngineError(
          'PAGE_BUDGET',
          'Visible pages exceed the resident budget; no incomplete surface is rendered',
        );
      const fallbackReason = 'Visible pages exceed resident budget';
      onFallback(fallbackReason);
      baseline.render(camera);
      ownedRenderer.render(baseline.scene, camera);
      emit({
        eventVersion: 1,
        type: 'fallback',
        audience: 'diagnostic',
        recovered: true,
        code: 'PAGE_BUDGET',
        detail: fallbackReason,
      });
      diagnose('fallback', 'Visible pages exceed resident budget', {
        kind: 'fallback',
        reason: fallbackReason,
        from: backend.id,
        to: baseline.id,
        scope,
      });
      return;
    }
    ownedRenderer.render(backend.scene, camera);
    steps.cpuStep?.(7, performance.now() - retainEnd);
    steps.cpuFrameEnd?.();
  };
  return drawBackend;
}
