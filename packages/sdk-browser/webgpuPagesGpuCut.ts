import type * as THREE from 'three';
import { cameraSelectionUniforms } from './gpuSelection.ts';
import { appendAll, partitionByPass, triangleSum } from './webgpuPagesHelpers.ts';
import { abandonFrameEncoder, openFrameEncoder } from './webgpuPagesEncoder.ts';
import { dropGpuSelection } from './webgpuPagesDrops.ts';
import { ensureTargets } from './webgpuPagesTargets.ts';
import { encodeDraws, ensurePageTable } from './webgpuPagesEncodeDraws.ts';
import {
  admitGpuCut,
  selectTransparentCut,
  transitionGpuCut,
} from './webgpuPagesGpuCutAdmission.ts';
import {
  recordGpuCutTiming,
  traceGpuCutFrame,
  traceGpuCutWaiting,
} from './webgpuPagesGpuCutTrace.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Falls back to the CPU cut for this image after the GPU selection let it down. */
function renderWithoutGpuSelection(rt: WebgpuPagesRuntime, camera: THREE.PerspectiveCamera) {
  dropGpuSelection(rt);
  rt.run.gpuFrameActive = false;
  rt.backend.render(camera);
}

/** One image driven by the GPU cluster cut: the mask of the current frame decides the draw, the
 *  readback of the previous one decides streaming and metrics. */
export function renderGpuCut(
  rt: WebgpuPagesRuntime,
  camera: THREE.PerspectiveCamera,
  pixelError: number,
  cpuStart: number,
  lightsEnd: number,
) {
  const { run, gpu, diag, context, services } = rt,
    { rows, transparentRoots, gpuWanted } = rt.layout,
    { gpuDevice, viewport, clearColor } = rt.setup;
  if (!gpuDevice || !gpu.cache || !run.gpuSelection) return;
  run.gpuFrameActive = true;
  // `budgetPixelError` carries the previous frame's verdict, the same feedback `pageBudget` applies
  // on the CPU path.
  const budgeted = Math.max(pixelError, run.budgetPixelError);
  cameraSelectionUniforms(camera, budgeted, viewport, run.selectionUniforms);
  services.adoptGpuCut();
  const adoptEnd = performance.now();
  const transparent = transparentRoots.length
    ? selectTransparentCut(rt, camera, budgeted, false)
    : undefined;
  const transparentSelectEnd = performance.now();
  const oldOpaque = partitionByPass(run.shown, false, run.opaqueScratch);
  run.shown.length = 0;
  appendAll(run.shown, oldOpaque, transparent?.shown ?? []);
  run.desired.length = 0;
  appendAll(run.desired, gpuWanted, transparent?.wanted ?? []);
  if (run.gpuMetricsReady) run.visible = run.desired.length;
  admitGpuCut(rt, pixelError, budgeted);
  if (!services.bootstrapState.ready) {
    run.gpuMetricsReady = false;
    traceGpuCutWaiting(rt);
    return;
  }
  transitionGpuCut(rt, camera, budgeted, transparent, oldOpaque);
  const admissionEnd = performance.now();
  services.queueResident(services.budgetedResidency(run.desired));
  // Enumerate the bounded resident candidates once. GPU selection and compaction
  // share their page indices; no CPU frustum/LOD traversal or regrouping follows.
  const queueEnd = performance.now();
  ensurePageTable(rt, gpuDevice);
  services.syncRows();
  run.rowsSyncedFrame = run.frame;
  const rowsEnd = performance.now();
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
    return renderWithoutGpuSelection(rt, camera);
  }
  if (run.gpuSelection.updateResidency(rows.residentFlags)) run.gpuMetricsReady = false;
  const residencyUploadEnd = performance.now();
  try {
    rt.timing.frameSelection = run.gpuSelection.dispatch(
      run.selectionUniforms,
      openFrameEncoder(rt, gpuDevice),
    );
  } catch (error) {
    abandonFrameEncoder(rt);
    diag.diagnosticFailure('gpu-selection-dispatch-failed', error);
    return renderWithoutGpuSelection(rt, camera);
  }
  run.drawn.length = 0;
  appendAll(run.drawn, run.shown);
  const selectionEnd = performance.now();
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
  const encodeStart = performance.now();
  try {
    encodeDraws(rt, gpuDevice, camera);
  } catch (error) {
    abandonFrameEncoder(rt);
    if (context.gpuCanvas) throw error;
    return renderWithoutGpuSelection(rt, camera);
  }
  // An encode path that returned without submitting would strand the selection's readback slot.
  abandonFrameEncoder(rt);
  const cpuEnd = performance.now();
  if (run.gpuMetricsReady)
    run.submittedTriangles = triangleSum(run.shown, false) + run.blendSubmittedTriangles;
  recordGpuCutTiming(rt, {
    cpuStart,
    lightsEnd,
    adoptEnd,
    transparentSelectEnd,
    admissionEnd,
    queueEnd,
    rowsEnd,
    residencyUploadEnd,
    selectionEnd,
    encodeStart,
    cpuEnd,
  });
  traceGpuCutFrame(rt, camera);
}
