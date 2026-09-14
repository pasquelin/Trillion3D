import type * as THREE from 'three';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { appendAll, keepOpaqueHead } from './webgpuPagesHelpers.ts';
import { abandonFrameEncoder, openFrameEncoder } from './webgpuPagesEncoder.ts';
import { dropGpuSelection } from './webgpuPagesDrops.ts';
import { ensureTargets } from './webgpuPagesTargets.ts';
import { encodeDraws, ensurePageTable } from './webgpuPagesEncodeDraws.ts';
import {
  admitGpuCut,
  opaqueTriangles,
  selectTransparentCut,
  transitionGpuCut,
} from './webgpuPagesGpuCutAdmission.ts';
import {
  recordGpuCutTiming,
  traceGpuCutFrame,
  traceGpuCutWaiting,
} from './webgpuPagesGpuCutTrace.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Gives the image up to the CPU cut after the GPU selection let it down. */
function withoutGpuSelection(rt: WebgpuPagesRuntime) {
  dropGpuSelection(rt);
  rt.run.gpuFrameActive = false;
  return false;
}

/** One image driven by the GPU cluster cut: the mask of the current frame decides the draw, the
 *  readback of the previous one decides streaming and metrics. Returns false when the caller must
 *  render the image again through the CPU cut. */
export function renderGpuCut(
  rt: WebgpuPagesRuntime,
  camera: THREE.PerspectiveCamera,
  pixelError: number,
  cpuStart: number,
  lightsEnd: number,
) {
  const { run, gpu, diag, context, services } = rt,
    { rows, transparentRoots } = rt.layout,
    { gpuDevice, viewport, clearColor } = rt.setup,
    marks = rt.timing.marks;
  if (!gpuDevice || !gpu.cache || !run.gpuSelection) return true;
  run.gpuFrameActive = true;
  run.cpuSelectMs = null;
  marks.cpuStart = cpuStart;
  marks.lightsEnd = lightsEnd;
  // `budgetPixelError` carries the previous frame's verdict, the same feedback `pageBudget` applies
  // on the CPU path.
  const budgeted = Math.max(pixelError, run.budgetPixelError);
  cameraSelectionUniforms(camera, budgeted, viewport, run.selectionUniforms);
  services.adoptGpuCut();
  marks.adoptEnd = performance.now();
  const transparent = transparentRoots.length
    ? selectTransparentCut(rt, camera, budgeted, false)
    : undefined;
  marks.transparentSelectEnd = performance.now();
  // The opaque head of both cuts is the one the readback maintains from image to image; only the
  // transparent tail, which no GPU cut selects, is rewritten here.
  run.transparentShown.length = 0;
  appendAll(run.transparentShown, transparent?.shown ?? []);
  run.transparentWanted.length = 0;
  appendAll(run.transparentWanted, transparent?.wanted ?? []);
  run.shownOpaque = keepOpaqueHead(run.shown, run.shownOpaque, run.opaqueScratch);
  appendAll(run.shown, run.transparentShown);
  run.desiredOpaque = keepOpaqueHead(run.desired, run.desiredOpaque, run.opaqueScratch);
  appendAll(run.desired, run.transparentWanted);
  if (run.gpuMetricsReady) run.visible = run.desired.length;
  admitGpuCut(rt, pixelError, budgeted);
  if (!services.bootstrapState.ready) {
    run.gpuMetricsReady = false;
    traceGpuCutWaiting(rt);
    return true;
  }
  transitionGpuCut(rt, camera, budgeted, transparent);
  marks.admissionEnd = performance.now();
  services.queueCutResidency();
  // Enumerate the bounded resident candidates once. GPU selection and compaction
  // share their page indices; no CPU frustum/LOD traversal or regrouping follows.
  marks.queueEnd = performance.now();
  ensurePageTable(rt, gpuDevice);
  services.syncRows();
  run.rowsSyncedFrame = run.frame;
  marks.rowsEnd = performance.now();
  if (rows.candidateOverflow) {
    // The CPU fallback can still select a representable visible subset.
    diag.engineDiagnostic(
      'gpu-selection-capacity',
      'Sélection CPU requise par la capacité des identifiants de visibilité',
      {
        residentCandidates: rows.candidateCount + rows.candidateOverflow,
        maxCandidates: rt.layout.drawSlots,
      },
    );
    return withoutGpuSelection(rt);
  }
  if (run.gpuSelection.updateResidency(rows.residentFlags)) run.gpuMetricsReady = false;
  marks.residencyUploadEnd = performance.now();
  try {
    rt.timing.frameSelection = run.gpuSelection.dispatch(
      run.selectionUniforms,
      openFrameEncoder(rt, gpuDevice),
    );
  } catch (error) {
    abandonFrameEncoder(rt);
    diag.diagnosticFailure('gpu-selection-dispatch-failed', error);
    return withoutGpuSelection(rt);
  }
  run.drawn.length = 0;
  appendAll(run.drawn, run.shown);
  marks.selectionEnd = performance.now();
  const [width, height] = viewport;
  ensureTargets(rt, gpuDevice, Math.max(1, width), Math.max(1, height));
  if (!run.renderPathLogged) {
    run.renderPathLogged = true;
    diag.engineDiagnostic('first-render-path', 'Configuration du premier rendu WebGPU', {
      clearColor: `#${clearColor.toString(16).padStart(6, '0')}`,
      targetSize: gpu.targetSize,
      visibilityBuffer: true,
      selection: 'current-frame-mask',
      residentCandidates: rows.candidateCount,
    });
  }
  marks.encodeStart = performance.now();
  try {
    encodeDraws(rt, gpuDevice, camera);
  } catch (error) {
    abandonFrameEncoder(rt);
    if (context.gpuCanvas) throw error;
    return withoutGpuSelection(rt);
  }
  // An encode path that returned without submitting would strand the selection's readback slot.
  abandonFrameEncoder(rt);
  marks.cpuEnd = performance.now();
  if (run.gpuMetricsReady)
    run.submittedTriangles = opaqueTriangles(run) + run.blendSubmittedTriangles;
  recordGpuCutTiming(rt);
  traceGpuCutFrame(rt, camera);
  return true;
}
