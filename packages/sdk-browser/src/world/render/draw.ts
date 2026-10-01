import { explorerSwitch } from '../../../../sdk-core/src/runtime/explorerSwitches.ts';
import { EngineError, type GpuPassTimings } from '../../../../sdk-core/src/index.ts';
import { PAGE_REQUEST_BATCH, PREFETCH_BATCH, PREFETCH_INTERVAL_MS } from '../../backend/common.ts';
import { PRIORITY_PREFETCH } from '../../streaming/priority.ts';
import { fenceAllocations, settleAllocations } from '../../webgl/core/allocation.ts';
import { createWebglFrameTimer, webglPassSample } from '../../webgl/core/frameTimer.ts';
import type { RenderBackend } from '../../backend/types.ts';
import type { HostCpuProfile } from '../../host/cpuProfile.ts';
import type { createFrameComposer } from './compose.ts';
import type { HostCamera } from '../../camera/world.ts';
import type { WebglRenderTarget } from '../../webgl/core/renderTarget.ts';
import { retainVisiblePages } from '../../page/retainVisiblePages.ts';
import { frameStart } from '../../frame/scheduling.ts';
import type { createPageStreamer } from '../../streaming/pageStreamer.ts';
import type { createExplorerStreaming } from '../scene/streaming.ts';
import type { ExplorerHostState } from './hostState.ts';
import type { ExplorerSession } from '../session/session.ts';
import type { WebglSurface } from '../../webgl/core/surface.ts';

type Inputs = {
  camera: HostCamera;
  geometryUrls: Set<string>;
  streamer: ReturnType<typeof createPageStreamer>;
  streaming: ReturnType<typeof createExplorerStreaming>;
  directGpu: boolean;
  webglSurface?: WebglSurface;
  baseline: RenderBackend;
  state: Pick<
    ExplorerHostState,
    'measuring' | 'fallbackReason' | 'active' | 'hostFrame' | 'xrDraw'
  >;
  compose: ReturnType<typeof createFrameComposer>;
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

/** The sample of an image WebGL2 timed, named by its frame: the passes the draw path named under
 *  `gpuPassMs`, and the whole image's duration under `gpuFrameMs`. */
export function createExplorerDraw(session: ExplorerSession, inputs: Inputs) {
  const { scope, emit, diagnose } = session;
  const { camera, geometryUrls, streamer, streaming, baseline, state, compose } = inputs;
  const { directGpu, webglSurface } = inputs;
  // WebGL2 cannot timestamp a pass: the timer wraps each contiguous pass the draw path names, in
  // order, whenever the context grants the extension; the frame metrics and the step profile read
  // them (`frameTimer.ts`).
  const profiled = explorerSwitch(session.options, 'stageProfile');
  const gpuTimer = webglSurface && !directGpu ? createWebglFrameTimer(webglSurface.context) : null;
  const gpu = { frameMs: null as number | null, passes: null as GpuPassTimings | null };
  const drawBackend = (backend: RenderBackend, target: WebglRenderTarget | null) => {
    const { measuring } = state;
    const steps = backend as HostCpuProfile,
      scale = backend.renderScaleControl;
    scale?.tick(frameStart(), gpuTimer?.supported === true);
    // Before any command: the errors of allocations the GPU ran past, read without a wait.
    settleAllocations(webglSurface?.context);
    if (state.xrDraw) state.xrDraw(backend);
    else backend.render(camera);
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
    if (directGpu || state.xrDraw) {
      // The engine draws into the page canvas: nothing to compose, but the frame closes here,
      // where the bounds the host just sampled still belong to it.
      fenceAllocations(webglSurface?.context);
      steps.cpuFrameEnd?.();
      if (backend.overBudget)
        throw new EngineError('PAGE_BUDGET', 'Visible pages exceed the resident budget');
      return;
    }
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
      compose(baseline, target, false);
      fenceAllocations(webglSurface?.context);
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
    // A held image put back times the copy, not a drawing: no metric names it (`gpuFrameMs`).
    gpuTimer?.begin(backend.frameHeld === true ? null : state.hostFrame);
    compose(backend, target, true, true, gpuTimer?.pass);
    // A held image put back, or one drawn into a target at the display's size, measures no
    // drawing at the scale (and leaves `steered` as the last surface image set it): it never
    // steps the controller.
    const moving = !target && scale?.steered === true && backend.frameHeld !== true;
    gpuTimer?.end(scale && { scale: scale.drawn, steered: moving });
    fenceAllocations(webglSurface?.context);
    steps.cpuStep?.('submitMs', performance.now() - retainEnd);
    if (gpuTimer) {
      // Reread a few frames later, with its image's scale: the read never blocks this frame.
      const read = gpuTimer.poll();
      if (profiled) steps.gpuImageMs?.(read.ms, gpuTimer.supported, read.reason ?? gpuTimer.reason);
      scale?.observe(read.ms, read.tag?.scale, read.tag?.steered ?? false);
      // A ready read publishes its pass list, even truncated (its total then stays null); a not
      // ready, disjoint or unreadable one is dropped, leaving the previous sample in place.
      if (read.reason === null) {
        gpu.frameMs = read.frame === null ? null : read.ms;
        gpu.passes = read.frame === null ? null : webglPassSample(read.frame, read);
      }
    }
    steps.cpuFrameEnd?.();
  };
  /** The last image the timer read, as the frame metrics carry it (`webglPassSample`). */
  return Object.assign(drawBackend, { gpu: gpu as Readonly<typeof gpu> });
}
