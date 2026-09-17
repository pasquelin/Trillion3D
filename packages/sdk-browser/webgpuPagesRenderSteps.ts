import type { PageRec } from './pageSelection.ts';
import { urlsOf } from './webgpuPagesHelpers.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** The residency traces of the CPU path, each stamped with the time its step took. */
export function traceAdmission(
  rt: WebgpuPagesRuntime,
  requested: Set<string>,
  wanted: readonly PageRec[],
  started: number,
) {
  const { run, diag } = rt,
    { tracking, slots } = rt.setup;
  diag.traceDiagnostic('residency-admission', 'Admission des ensembles demandés', () => ({
    frame: run.frame,
    scope: 'cpu/residency-admission',
    elapsedMs: performance.now() - started,
    requested: tracking.traceSet('admission.requested', [...requested]),
    // La coupe que l'admission pèse est celle qui vient d'être choisie ; `run.desired` porte encore
    // celle que l'image précédente a publiée, et ne décrit donc pas ce passage-ci.
    wanted: tracking.traceSet('admission.wanted', urlsOf(wanted)),
    loaded: tracking.traceSet('admission.loaded', urlsOf(run.drawn)),
    slots,
    limited: run.coverageBudgetLimited,
  }));
}

export function traceTransition(
  rt: WebgpuPagesRuntime,
  requested: Set<string>,
  transition: Set<string>,
  started: number,
) {
  const { run, diag } = rt,
    { tracking, slots } = rt.setup;
  diag.traceDiagnostic('residency-transition', 'Transition de couverture calculée', () => ({
    frame: run.frame,
    scope: 'cpu/residency-transition',
    elapsedMs: performance.now() - started,
    from: tracking.traceSet('transition.from', urlsOf(run.drawn)),
    to: tracking.traceSet('transition.to', urlsOf(run.shown)),
    requested: tracking.traceSet('transition.requested', [...requested]),
    transition: tracking.traceSet('transition.all', [...transition]),
    slots,
  }));
}

export function traceQueueReconstruct(rt: WebgpuPagesRuntime, elapsedMs: number) {
  const { run, diag } = rt,
    { tracking } = rt.setup,
    { residency } = rt.services;
  diag.traceDiagnostic(
    'residency-queue-reconstruct',
    'Ensembles de résidence reconstruits',
    () => ({
      frame: run.frame,
      scope: 'cpu/residency-queue-reconstruct',
      elapsedMs,
      requested: tracking.traceSet('reconstruct.requested', urlsOf(run.desired)),
      queued: tracking.traceSet('reconstruct.queued', urlsOf(residency.items)),
      job: residency.job,
    }),
  );
}

export function traceDrawnVerify(rt: WebgpuPagesRuntime, elapsedMs: number) {
  const { run, gpu, diag } = rt,
    { tracking } = rt.setup;
  diag.traceDiagnostic(
    'residency-drawn-verify',
    'Couverture résidente vérifiée avant encodage',
    () => ({
      frame: run.frame,
      scope: 'cpu/residency-drawn-copy',
      elapsedMs,
      shown: tracking.traceSet('drawn.shown', urlsOf(run.shown)),
      drawn: tracking.traceSet('drawn', urlsOf(run.drawn)),
      loaded: tracking.traceSet(
        'drawn.loaded',
        urlsOf(run.drawn.filter((page) => !!gpu.cache!.get(page.url))),
      ),
    }),
  );
}

export function traceTargetsEnsured(
  rt: WebgpuPagesRuntime,
  width: number,
  height: number,
  started: number,
) {
  rt.diag.traceDiagnostic('targets-ensure', 'Cibles GPU assurées', () => ({
    frame: rt.run.frame,
    scope: 'cpu/ensureTargets',
    elapsedMs: performance.now() - started,
    width,
    height,
  }));
}

/** Logs the configuration of the first CPU-cut image once, on the host console too. */
export function logFirstCpuRenderPath(rt: WebgpuPagesRuntime) {
  const { run, vis, gpu, diag } = rt;
  if (run.renderPathLogged) return;
  run.renderPathLogged = true;
  const details = {
    clearColor: `#${rt.setup.clearColor.toString(16).padStart(6, '0')}`,
    targetSize: gpu.targetSize,
    visibilityBuffer: vis.visEnabled,
    visibilityReady: !!(vis.visPipelineBack && vis.shadePipeline && vis.visView),
    selectedPages: run.shown.length,
    drawnPages: run.drawn.length,
  };
  diag.engineDiagnostic('first-render-path', 'Configuration du premier rendu WebGPU', details);
  if (typeof window !== 'undefined')
    console.info('[web-geometry] configuration du premier rendu WebGPU', details);
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
     *  sa différence est celle de la coupe, pas celle que la résidence a remuée. */
    residencyPagesEntered: run.pagesEntered,
    residencyPagesExited: run.pagesExited,
  };
}
