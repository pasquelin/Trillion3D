import type { EngineCamera } from '../../../camera/world.ts';
import { cameraSelectionUniforms } from '../../../gpu/core/selection.ts';
import { mirrorDrawnFromShown } from '../helpers.ts';
import { abandonFrameEncoder, openFrameEncoder } from './encoder.ts';
import { fallbackToCpuCut } from '../io/drops.ts';
import { encodeDraws } from './encodeDraws.ts';
import { admitGpuCut } from './gpuCutAdmission.ts';
import { dispatchWaitingSelection, streamCutResidency } from './gpuCutStream.ts';
import { keepWebgpuFrame } from '../../frame/hold.ts';
import { recordGpuCutTiming, traceGpuCutFrame, traceGpuCutWaiting } from './gpuCutTrace.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** Gives the image up to the CPU cut after the GPU selection let it down. */
function withoutGpuSelection(rt: WebgpuPagesRuntime, reason: string) {
  fallbackToCpuCut(rt, reason);
  rt.run.gpuFrameActive = false;
  return false;
}

/** Visibility-identifier overflow: only the CPU cut still knows how to pick a representable subset.
 *  The waiting image suffers it like the complete image. */
function withoutCandidateCapacity(rt: WebgpuPagesRuntime) {
  const { rows } = rt.layout;
  rt.diag.engineDiagnostic(
    'gpu-selection-capacity',
    'CPU selection required by visibility-identifier capacity',
    {
      residentCandidates: rows.candidateCount + rows.candidateOverflow,
      maxCandidates: rt.layout.drawSlots,
    },
  );
  return withoutGpuSelection(rt, 'visibility-identifier capacity');
}

/** One image driven by the GPU cluster cut: the mask of the current frame decides the draw, the
 *  readback of the previous one decides streaming and metrics. Returns false when the caller must
 *  render the image again through the CPU cut. */
export function renderGpuCut(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  pixelError: number,
  cpuStart: number,
  lightsEnd: number,
) {
  const { run, gpu, diag, context, services } = rt,
    { rows } = rt.layout,
    { viewport } = rt.setup,
    { clearColor } = run,
    gpuDevice = gpu.device,
    marks = rt.timing.marks;
  if (!gpuDevice || !gpu.cache || !run.gpuSelection) {
    // Origin of the resource change: the device, the cache or the selection has gone.
    run.gate.resourcesChanged();
    return true;
  }
  run.gpuFrameActive = true;
  run.cpuSelectMs = null;
  marks.cpuStart = cpuStart;
  marks.lightsEnd = lightsEnd;
  // The host's threshold, and no other: residency coarsens, one DAG level where a page is missing
  // (`../../../page/cut/rule.ts`).
  cameraSelectionUniforms(cam, pixelError, viewport, run.selectionUniforms, run.motion);
  // An image that adopts no readback moves no page; the adoption reports what it actually moved.
  run.pagesEntered = 0;
  run.pagesExited = 0;
  services.adoptGpuCut();
  marks.adoptEnd = performance.now();
  // The sample did not fit under its ceiling: the reported list is truncated, and only the CPU cut
  // still knows how to pick a representable subset — as for visibility-identifier overflow.
  if (gpu.cutTruncated) return withoutGpuSelection(rt, 'truncated cut sample');
  // One cut covers both passes: the image sweeps no DAG of its own for the transparents any more.
  marks.transparentSelectEnd = marks.adoptEnd;
  if (run.gpuMetricsReady) run.visible = run.desired.length;
  admitGpuCut(rt);
  if (!services.bootstrapState.ready) {
    // The root cover is not resident yet: nothing can be drawn, nor held. Origin of the resource
    // change: bootstrap does not yet have all its pages. Once it has, every surface is drawn by a
    // resident representation (`../../../page/cut/rule.ts`), and no frame waits again.
    run.gate.resourcesChanged();
    run.gpuMetricsReady = false;
    marks.admissionEnd = performance.now();
    // The wait keeps asking for missing pages, syncing residency and sending selection — that is
    // the only send that can produce the sample of the resume.
    // Overflow or a lost send take from the wait every way to succeed: it can no longer wait for a
    // sample nobody will produce, and the CPU cut takes the image back.
    if (!streamCutResidency(rt, gpuDevice, run.gpuSelection)) return withoutCandidateCapacity(rt);
    if (!dispatchWaitingSelection(rt, run.gpuSelection))
      return withoutGpuSelection(rt, 'selection send error');
    traceGpuCutWaiting(rt);
    return true;
  }
  marks.admissionEnd = performance.now();
  // The CPU fallback can still select a representable visible subset.
  if (!streamCutResidency(rt, gpuDevice, run.gpuSelection)) return withoutCandidateCapacity(rt);
  try {
    rt.timing.frameSelection = run.gpuSelection.dispatch(
      run.selectionUniforms,
      openFrameEncoder(rt, gpuDevice),
    );
  } catch (error) {
    abandonFrameEncoder(rt);
    diag.diagnosticFailure('gpu-selection-dispatch-failed', error);
    return withoutGpuSelection(rt, 'selection send error');
  }
  // An image that neither adoption nor the CPU cut has touched these lists of would push eighty
  // thousand records already in place: the flag says so, the copy abstains.
  mirrorDrawnFromShown(run);
  marks.selectionEnd = performance.now();
  if (!run.renderPathLogged) {
    run.renderPathLogged = true;
    diag.engineDiagnostic('first-render-path', 'WebGPU first render configuration', {
      clearColor: `#${clearColor.toString(16).padStart(6, '0')}`,
      targetSize: gpu.targetSize,
      visibilityBuffer: true,
      selection: 'current-frame-mask',
      residentCandidates: rows.candidateCount,
    });
  }
  marks.encodeStart = performance.now();
  try {
    encodeDraws(rt, gpuDevice, cam);
  } catch (error) {
    abandonFrameEncoder(rt);
    if (context.gpuCanvas) throw error;
    return withoutGpuSelection(rt, 'draw encoding error');
  }
  // An encode path that returned without submitting would strand the selection's readback slot.
  abandonFrameEncoder(rt);
  marks.cpuEnd = performance.now();
  // The cut's own triangles came back with the readback; the meshes outside the DAG are counted
  // where they are drawn.
  if (run.gpuMetricsReady)
    run.submittedTriangles = run.selectedTriangles + run.blendUnpagedTriangles;
  recordGpuCutTiming(rt);
  traceGpuCutFrame(rt, cam);
  // The image was encoded and submitted in full: it alone allows a hold, and only if the previous
  // one was already identical to it.
  keepWebgpuFrame(rt);
  return true;
}
