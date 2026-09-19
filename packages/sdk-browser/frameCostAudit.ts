import { frustumExcludesBox, type FrameMetrics } from '../sdk-core/index.ts';
import { enginePose, type EngineCamera } from './cameraWorld.ts';
import { sideOf } from './materialSide.ts';
import { SDK_BUILD_PROVENANCE } from './buildProvenance.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** The question asked of the URL, and the answer it gave: the string is reread on every call —
 *  the audit is queried per frame — but it is parsed only once per string. */
let auditSearch: string | undefined,
  auditEnabled = false;

/** Opt-in audit, no per-frame trace: add `wgFrameAudit=1` to the host URL. */
export function frameCostAuditEnabled() {
  const search = typeof location === 'undefined' ? undefined : location.search;
  if (search !== auditSearch) {
    auditSearch = search;
    auditEnabled = search !== undefined && new URLSearchParams(search).get('wgFrameAudit') === '1';
  }
  return auditEnabled;
}

/** Serialisation and the console stay outside the measured render call. */
export function logFrameCostAudit(backend: string, context: Record<string, unknown>) {
  if (!frameCostAuditEnabled()) return;
  queueMicrotask(() => {
    try {
      console.info('[WG frame audit]', JSON.stringify({ backend, ...context }));
    } catch {
      // An observer must never interrupt the render.
    }
  });
}

/** The view as the audit publishes it: the engine camera’s world pose, and its field. */
const poseDeLaVue = (cam: EngineCamera) => ({
  ...enginePose(cam),
  fov: cam.fov,
  near: cam.near,
  far: cam.far,
});

/** Counts once per snapshot the commands whose box is entirely out of frustum.
 * This lower bound does not invent GPU-mask results and does not change any selection. */
export function gpuFrameCostSnapshot(rt: WebgpuPagesRuntime) {
  if (!frameCostAuditEnabled()) return undefined;
  let outsideItems = 0,
    outsideDraws = 0,
    unknownBounds = 0;
  const { blendState, run, timing } = rt;
  for (const item of blendState.visibleBlend) {
    const box = item.bounds;
    if (!box) {
      unknownBounds++;
      continue;
    }
    if (!frustumExcludesBox(blendState.blendPlanes, box[0], box[1], box[2], box[3], box[4], box[5]))
      continue;
    outsideItems++;
    const material = Array.isArray(item.material) ? item.material[0] : item.material;
    outsideDraws += sideOf(material) === 'double' && !material.forceSinglePass ? 2 : 1;
  }
  return {
    selection: run.gpuFrameActive ? 'gpu' : 'cpu',
    // The published pose is the engine camera’s, which frame entry has just copied:
    // no host camera is reread here, and nothing is read until a frame has been rendered.
    camera: run.lastCamera && poseDeLaVue(run.gate.cam),
    resolution: [...rt.gpu.targetSize],
    pixelError: run.diagnosticPixelError,
    transparentCandidates: blendState.blendGpu.length,
    transparentListed: blendState.visibleBlend.length,
    transparentEncodedDraws: run.blendDrawCalls,
    transparentSelectMs: timing.transparentSelectMs,
    transparentPrepareMs: timing.transparentPrepareMs,
    transparentDrawMs: timing.transparentDrawMs,
    transparentSpanUploadBytes: timing.transparentSpanUploadBytes,
    listedOutsideFrustum: outsideItems,
    outsideDrawsIfTextured: outsideDraws,
    unknownBounds,
    gpuEmptyDraws: null,
    pagedItems: blendState.table?.pagedItems.length ?? 0,
    compactionEntriesWithPadding: blendState.table?.length ?? 0,
    gpuCompactionAvailable: !!blendState.compaction?.encode,
    gpuTiming: timing.lastGpuPassMs,
    gpuFrameMs: timing.lastGpuFrameMs,
    gpuTimingIsAsynchronous: true,
  };
}

/** Counters the host renderer holds. Read by their shape: no computation comes out of them, and
 *  the audit does not have to name the type of a library it only consults. */
type HostRenderer = {
  info: { render: { calls: number; triangles: number } };
  extensions: { has(name: string): boolean };
};

/** Host view, with real Three counters when this engine owns the WebGL render.
 * Detailed CPU percentiles are published separately by the existing profiles. */
export function createHostFrameCostAudit() {
  let last = -Infinity;
  return (backend: string, frame: number, metrics: FrameMetrics, renderer: HostRenderer | null) => {
    if (!frameCostAuditEnabled()) return;
    const now = performance.now();
    if (now - last < 2000) return;
    last = now;
    logFrameCostAudit(backend, {
      kind: 'host',
      frame,
      build: { hash: SDK_BUILD_PROVENANCE.hash, generatedAt: SDK_BUILD_PROVENANCE.generatedAt },
      dpr: typeof devicePixelRatio === 'number' ? devicePixelRatio : null,
      cpuFrameMs: metrics.cpuFrameMs,
      cpuSubmitMs: metrics.cpuSubmitMs,
      cpuSelectMs: metrics.cpuSelectMs,
      reportedDrawCalls: metrics.drawCalls,
      selectedTriangles: metrics.selectedTriangles,
      reportedSubmittedTriangles: metrics.totalSubmittedTriangles,
      transparentDrawCalls: metrics.transparentDrawCalls,
      pagesLoading: metrics.pagesLoading,
      residentPages: metrics.residentPages,
      webglRendererCalls: renderer?.info.render.calls ?? null,
      webglRendererTriangles: renderer?.info.render.triangles ?? null,
      webglMultiDraw: renderer?.extensions.has('WEBGL_multi_draw') ?? null,
    });
  };
}
