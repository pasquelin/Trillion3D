import type { PageRec } from '../../../page/selection/selection.ts';
import { urlsOf } from '../helpers.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** The residency traces of the CPU path, each stamped with the time its step took. */
export function traceAdmission(
  rt: WebgpuPagesRuntime,
  requested: Set<string>,
  wanted: readonly PageRec[],
  started: number,
) {
  const { run, diag } = rt,
    { tracking, slots } = rt.setup;
  diag.traceDiagnostic('residency-admission', 'Admission of the requested sets', () => ({
    frame: run.frame,
    scope: 'cpu/residency-admission',
    elapsedMs: performance.now() - started,
    requested: tracking.traceSet('admission.requested', [...requested]),
    // The cut admission weighs is the one just chosen; `run.desired` still carries the one the previous
    // image published, and therefore does not describe this pass.
    wanted: tracking.traceSet('admission.wanted', urlsOf(wanted)),
    loaded: tracking.traceSet('admission.loaded', urlsOf(run.drawn)),
    slots,
    limited: run.coverageBudgetLimited,
  }));
}

export function traceQueueReconstruct(rt: WebgpuPagesRuntime, elapsedMs: number) {
  const { run, diag } = rt,
    { tracking } = rt.setup,
    { residency } = rt.services;
  diag.traceDiagnostic('residency-queue-reconstruct', 'Residency sets rebuilt', () => ({
    frame: run.frame,
    scope: 'cpu/residency-queue-reconstruct',
    elapsedMs,
    requested: tracking.traceSet('reconstruct.requested', urlsOf(run.desired)),
    queued: tracking.traceSet('reconstruct.queued', urlsOf(residency.items)),
    job: residency.job,
  }));
}

export function traceDrawnVerify(rt: WebgpuPagesRuntime, elapsedMs: number) {
  const { run, diag, services } = rt,
    { tracking } = rt.setup;
  diag.traceDiagnostic('residency-drawn-verify', 'Resident coverage checked before encode', () => ({
    frame: run.frame,
    scope: 'cpu/residency-drawn-copy',
    elapsedMs,
    shown: tracking.traceSet('drawn.shown', urlsOf(run.shown)),
    drawn: tracking.traceSet('drawn', urlsOf(run.drawn)),
    loaded: tracking.traceSet('drawn.loaded', urlsOf(run.drawn.filter(services.poolHolds))),
  }));
}

/** Logs the configuration of the first CPU-cut image once, on the host console too. */
export function logFirstCpuRenderPath(rt: WebgpuPagesRuntime) {
  const { run, vis, gpu, diag } = rt;
  if (run.renderPathLogged) return;
  run.renderPathLogged = true;
  const details = {
    clearColor: `#${rt.run.clearColor.toString(16).padStart(6, '0')}`,
    targetSize: gpu.targetSize,
    visibilityBuffer: vis.visEnabled,
    visibilityReady: !!(vis.visPipelineBack && vis.materialDepthPipeline && vis.visView),
    selectedPages: run.shown.length,
    drawnPages: run.drawn.length,
  };
  diag.engineDiagnostic('first-render-path', 'WebGPU first render configuration', details);
  if (typeof window !== 'undefined')
    console.info('[trillion3d] WebGPU first render configuration', details);
}

/** The CPU sample of an image, with `null` for the steps an image that did not draw never ran. */
export function cpuSampleOf(
  rt: WebgpuPagesRuntime,
  marks: { cpuStart: number; lightsEnd: number; selectionEnd: number; encodeStart?: number },
  cpuEnd: number,
) {
  const { run, timing } = rt,
    drew = marks.encodeStart !== undefined;
  return {
    version: 1,
    frame: run.frame,
    submission: run.imageRevision,
    scope: 'backend-render-call',
    totalMs: cpuEnd - timing.marks.preStart,
    lightsMs: marks.lightsEnd - marks.cpuStart,
    selectionMs: marks.selectionEnd - marks.lightsEnd,
    residencyScheduleAndTargetsMs: drew ? marks.encodeStart! - marks.selectionEnd : null,
    encodeSubmitMs: drew ? timing.lastSubmitMs : null,
    transparentEncodeMs: drew ? timing.transparentEncodeMs : 0,
    transparentIncludedIn: 'encodeSubmitMs',
    asyncResidencyWaitMs: null,
    /** Pages the residency path had to touch: the cut's difference, not its size. Null on a CPU cut :
     *  its delta is the cut's, not the one residency stirred. */
    residencyPagesEntered: run.pagesEntered,
    residencyPagesExited: run.pagesExited,
  };
}
