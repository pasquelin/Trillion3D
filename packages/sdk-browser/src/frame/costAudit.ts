import { frustumExcludesBox, type FrameMetrics } from '../../../sdk-core/src/index.ts';
import { enginePose, type EngineCamera } from '../camera/world.ts';
import { families } from '../host/families.ts';
import { addressFlag } from '../host/addressFlag.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

/** Opt-in audit, no per-frame trace: add `trillion3dFrameAudit=1` to the host URL. */
export const frameCostAuditEnabled = addressFlag(
  (params) => params.get('trillion3dFrameAudit') === '1',
);

/** Serialisation and the console stay outside the measured render call. */
export function logFrameCostAudit(backend: string, context: Record<string, unknown>) {
  if (!frameCostAuditEnabled()) return;
  queueMicrotask(() => {
    try {
      console.info('[Trillion3D frame audit]', JSON.stringify({ backend, ...context }));
    } catch {
      // An observer must never interrupt the render.
    }
  });
}

/** The view as the audit publishes it: the engine camera’s world pose, and its field. */
const viewPose = (cam: EngineCamera) => ({
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
    // The item's surface record says both: a double-sided blend is two draws unless the host
    // declared the single pass.
    outsideDraws += item.surface.doubleSided && !item.surface.forceSinglePass ? 2 : 1;
  }
  return {
    selection: run.gpuFrameActive ? 'gpu' : 'cpu',
    // The published pose is the engine camera’s, which frame entry has just copied:
    // no host camera is reread here, and nothing is read until a frame has been rendered.
    camera: run.lastCamera && viewPose(run.gate.cam),
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

/** Host view: what the frame published, as the engine counted it.
 * Detailed CPU percentiles are published separately by the existing profiles. */
export function createHostFrameCostAudit() {
  let last = -Infinity;
  return (backend: string, frame: number, metrics: FrameMetrics) => {
    if (!frameCostAuditEnabled()) return;
    const now = performance.now();
    if (now - last < 2000) return;
    last = now;
    // The provenance, a family the session opened with when the audit is on (`familyUse.ts`).
    const build = families.measurement.get()?.SDK_BUILD_PROVENANCE;
    logFrameCostAudit(backend, {
      kind: 'host',
      frame,
      build: { hash: build?.hash ?? null, generatedAt: build?.generatedAt ?? null },
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
    });
  };
}
