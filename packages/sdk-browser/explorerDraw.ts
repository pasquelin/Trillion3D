import * as THREE from 'three';
import { EngineError } from '../sdk-core/index.ts';
import { PAGE_REQUEST_BATCH, PREFETCH_BATCH, PREFETCH_INTERVAL_MS } from './backendCommon.ts';
import { PRIORITY_PREFETCH } from './streamingPriority.ts';
import { createWebglFrameTimer } from './webglFrameTimer.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { HostCpuProfile } from './hostCpuProfile.ts';
import { createHeldFrame } from './explorerHeldFrame.ts';
import { retainVisiblePages } from './retainVisiblePages.ts';
import type { createPageStreamer } from './streamingPages.ts';
import type { createExplorerStreaming } from './explorerStreaming.ts';
import type { ExplorerHostState } from './explorerHostState.ts';
import type { ExplorerSession } from './explorerSession.ts';

type Inputs = {
  camera: THREE.PerspectiveCamera;
  geometryUrls: Set<string>;
  streamer: ReturnType<typeof createPageStreamer>;
  streaming: ReturnType<typeof createExplorerStreaming>;
  directGpu: boolean;
  renderer: THREE.WebGLRenderer;
  presentBackend: (backend: RenderBackend) => boolean;
  baseline: RenderBackend;
  state: Pick<ExplorerHostState, 'measuring' | 'fallbackReason' | 'active'>;
};

/**
 * Addresses of the ring that nothing holds yet, at most `limite`. The ring carries thousands
 * of addresses and the batch takes a few: the loop stops at a full batch, where a filter of
 * the whole ring built a complete array only to keep its head.
 */
export function anneauFroid(
  ring: readonly string[],
  streamer: Pick<ReturnType<typeof createPageStreamer>, 'has' | 'loading' | 'failed'>,
  limite: number,
) {
  const cold: string[] = [];
  for (let i = 0; i < ring.length && cold.length < limite; i++) {
    const url = ring[i];
    if (!streamer.has(url) && !streamer.loading(url) && !streamer.failed(url)) cold.push(url);
  }
  return cold;
}

/**
 * Addresses that a request already gone will send again later. Same addresses and same add
 * order as a hand-deduped array: membership is that of the structure, where an `includes`
 * rewalked the whole list for every address, frame after frame.
 */
export function empileEnAttente(attente: Set<string>, urls: readonly string[]) {
  for (const url of urls) attente.add(url);
}

export function createExplorerDraw(session: ExplorerSession, inputs: Inputs) {
  const { scope, emit, diagnose } = session;
  const { camera, geometryUrls, streamer, streaming, directGpu, presentBackend, baseline, state } =
    inputs;
  const ownedRenderer = inputs.renderer;
  // WebGL2 cannot timestamp a pass: the timer wraps the whole-frame submit, and is only
  // mounted if the host asked for the per-step profile.
  const gpuTimer =
    session.options.stageProfile === true && !directGpu && ownedRenderer
      ? createWebglFrameTimer(ownedRenderer.getContext() as WebGL2RenderingContext)
      : null;
  const heldFrame = createHeldFrame();
  const drawingSize = new THREE.Vector2();
  /**
   * Display chain of the Three-rendered engine, set on the engine view — the same rule as the
   * contract path. A scene with no declared light composes by identity: from linear to sRGB
   * and nothing else, albedo as-is (P6). As soon as a light exists, exposure and ACES come
   * back, last links of the chain (P4). The flag comes from the installed lights, never from
   * a host setting, and is written only when it changes: Three otherwise recompiles its programs.
   */
  const setDisplayChain = (backend: RenderBackend) => {
    const tone = backend.sceneLit?.() === false ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    if (ownedRenderer.toneMapping !== tone) ownedRenderer.toneMapping = tone;
  };
  /** Hands an engine's scene to the host renderer. A held frame cannot differ from the previous
   *  one — the engine just said so — and is redisplayed in one command, the scene not walked
   *  again; with none kept at this size, the first or after a resize, it is drawn then kept. */
  const drawScene = (backend: RenderBackend, target: THREE.WebGLRenderTarget | null) => {
    setDisplayChain(backend);
    ownedRenderer.getDrawingBufferSize(drawingSize);
    if (backend.frameHeld === true && !target && heldFrame.holds(drawingSize))
      heldFrame.present(ownedRenderer);
    else {
      ownedRenderer.render(backend.scene, camera);
      if (!target) heldFrame.keep(ownedRenderer, drawingSize);
    }
  };
  const drawBackend = (backend: RenderBackend, target: THREE.WebGLRenderTarget | null) => {
    const { measuring } = state;
    const steps = backend as HostCpuProfile;
    backend.render(camera);
    const renderEnd = performance.now();
    const missing = backend.pendingUrls?.() ?? [];
    if (missing.length > 0) {
      streaming.queueCached(backend, missing);
      // Per-frame budget on requests too: on a cold cache the missing list counts the pages
      // of the whole city, and making each frame a filtered array then a promise per address
      // cost more than the render. The list is ordered by priority — the most costly miss
      // first — so the head is enough; the rest leaves on the next frame, shorter by what
      // just arrived. The walk, for its part, goes to the end: a failed address does not
      // consume the batch and therefore never blocks those that follow.
      const needFetch: string[] = [];
      for (let i = 0; i < missing.length && needFetch.length < PAGE_REQUEST_BATCH; i++) {
        const url = missing[i];
        if (
          (geometryUrls.has(url) || !streamer.has(url)) &&
          !streamer.loading(url) &&
          !streamer.failed(url) &&
          !streaming.decodeFailures.has(url)
        )
          needFetch.push(url);
      }
      if (needFetch.length > 0) {
        if (!measuring && !streaming.promise) streaming.startFetch(needFetch);
        else if (!measuring && streaming.promise) {
          empileEnAttente(streaming.queuedFetch, needFetch);
          streaming.backgroundFetchController?.abort(
            new DOMException('Camera request superseded', 'AbortError'),
          );
        }
      }
    } else if (
      !measuring &&
      !streaming.promise &&
      !streaming.queuedFetch.size &&
      performance.now() - streaming.lastPrefetch > PREFETCH_INTERVAL_MS &&
      streamer.stats().loading === 0
    ) {
      // The network is idle and nothing visible is missing: pull the ring around the cut ahead of the
      // camera, at a priority any visible request outranks. A second selection pass costs as much as
      // the first, so it runs on a timer, never on every frame.
      streaming.lastPrefetch = performance.now();
      const ring = backend.prefetchUrls?.();
      if (ring && ring.length) {
        const cold = anneauFroid(ring, streamer, PREFETCH_BATCH);
        if (cold.length) streaming.startFetch(cold, PRIORITY_PREFETCH);
      }
    }
    const pendingEnd = performance.now();
    retainVisiblePages(backend, streamer);
    const retainEnd = performance.now();
    steps.cpuStep?.('pendingMs', pendingEnd - renderEnd);
    steps.cpuStep?.('retainMs', retainEnd - pendingEnd);
    if (directGpu) {
      // The engine draws into the page canvas: nothing to compose, but the frame closes here,
      // where the bounds the host just sampled still belong to it.
      steps.cpuFrameEnd?.();
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
      state.fallbackReason = fallbackReason;
      state.active = baseline;
      baseline.render(camera);
      setDisplayChain(baseline);
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
    gpuTimer?.begin();
    // An engine that presented its own surface is copied from it; the others hand their scene
    // over to the host renderer, the only case the held frame belongs to.
    if (!presentBackend(backend)) drawScene(backend, target);
    gpuTimer?.end();
    steps.cpuStep?.('submitMs', performance.now() - retainEnd);
    if (gpuTimer) {
      // A query reread a few frames later: the read never blocks the current frame.
      const read = gpuTimer.poll();
      steps.gpuImageMs?.(read.ms, gpuTimer.supported, read.reason ?? gpuTimer.reason);
    }
    steps.cpuFrameEnd?.();
  };
  return drawBackend;
}
