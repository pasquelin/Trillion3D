import type { PageRec } from './pageSelection.ts';
import { createCutDelta, type CutDelta } from './webgpuCutDelta.ts';
import { createCutCounts } from './webgpuCutCounts.ts';
import { createCutPending } from './webgpuCutPending.ts';
import { createWebgpuCutAdopter } from './webgpuCutAdoption.ts';
import { markDrawnMirrored } from './webgpuPagesHelpers.ts';
import type { WebgpuResidencySets } from './webgpuResidencySets.ts';
import type { WebgpuPagesCore } from './webgpuPagesRuntime.ts';

export type WebgpuCutPublication = ReturnType<typeof createWebgpuCutPublication>;

/**
 * La publication d'une coupe, par qui que ce soit qui la décide.
 *
 * Une coupe n'est jamais rendue comme une liste neuve : elle est publiée comme une DIFFÉRENCE — ce
 * qui vient d'entrer, ce qui vient de sortir —, et les lecteurs qui en vivent mettent à jour leurs
 * compteurs sans reparcourir quoi que ce soit. Le relevé de la carte y arrive par ses identifiants,
 * la coupe processeur par ses enregistrements, et le contrat est le même des deux côtés : c'est ce
 * qui permet à la carte, quand elle reprend l'image, de différer contre ce que le processeur a
 * laissé plutôt que de tout redemander.
 */
export function createWebgpuCutPublication(
  rt: WebgpuPagesCore,
  residencySets: WebgpuResidencySets,
) {
  const { run, gpu } = rt,
    { rows, packedPages, gpuWanted } = rt.layout;
  const cutDelta = createCutDelta(packedPages, run.desired);
  // La coupe dessinable ne sert que par sa différence : aucune liste d'enregistrements n'en est
  // tirée. L'adoption écrit `run.shown` à partir des mêmes identifiants, quand ils ont changé.
  const drawnDelta = createCutDelta(packedPages);
  const cutCounts = createCutCounts(packedPages, rows.residentOffsetWords);
  const cutPending = createCutPending(packedPages);
  // Les trois façons dont la couverture d'une grappe bascule — octets reçus, octets rendus, place de
  // cache prise ou rendue — passent toutes par le journal des rangs, qui les nomme une à une.
  rows.watchTouched((page) => {
    cutCounts.touch(page);
    cutPending.touch(page);
  });
  const publishCut = (delta: CutDelta) => {
    residencySets.applyCut(delta);
    cutPending.apply(delta);
  };
  const publishDrawn = (delta: CutDelta) => {
    residencySets.applyDrawn(delta);
    cutCounts.apply(delta);
  };
  // Readback describes submitted work and future streaming requests. It never
  // decides the cut drawn for a moving camera; the current GPU mask does that.
  const cutAdopter = createWebgpuCutAdopter({
    selection: () => run.gpuSelection,
    packedPages,
    desired: run.desired,
    shown: run.shown,
    drawn: run.drawn,
    uniforms: run.selectionUniforms,
    counts: cutCounts,
    delta: cutDelta,
    drawnDelta,
    onDrawnDelta: publishDrawn,
    onDrawnMirrored: () => markDrawnMirrored(run),
    onCutDelta: (delta) => {
      publishCut(delta);
      run.pagesEntered = delta.enteredCount;
      run.pagesExited = delta.exitedCount;
    },
  });
  // Before the first readback the image asks the cache for the pinned cover and nothing else.
  cutDelta.adoptRecords(gpuWanted);
  publishCut(cutDelta);
  /** Adopte le relevé et dit si l'IMAGE en est changée : si les listes affichées ont été réécrites.
   *  Un relevé neuf republiant les mêmes identifiants dans le même ordre n'en réécrit aucune. */
  const adoptGpuCut = () => {
    const adopted = cutAdopter.adopt(),
      metrics = cutAdopter.metrics;
    run.cutHeld = metrics.cutHeld;
    gpu.cutIncomplete = metrics.incomplete;
    // Une adoption qui réécrit les listes les fait changer d'âge, au rendu comme dans la vidange.
    if (metrics.listsRewritten) run.cutEpoch++;
    if (!adopted) return metrics.listsRewritten;
    run.visible = metrics.visible;
    run.selectedTriangles = metrics.selectedTriangles;
    run.uncoveredTriangles = metrics.uncoveredTriangles;
    run.submittedTriangles = metrics.selectedTriangles;
    run.drawnTriangles = metrics.drawnTriangles;
    run.blendPagedTriangles = metrics.transparentTriangles;
    run.frustumRejected = metrics.frustumRejected;
    run.lodLevel = metrics.lodLevel;
    run.gpuMetricsReady = metrics.ready;
    return metrics.listsRewritten;
  };
  return {
    /** Les pages de la coupe demandée qui attendent encore leurs octets. */
    cutPending,
    adoptGpuCut,
    /**
     * La coupe processeur publie la sienne par les mêmes différences : `wanted` écrit `run.desired`
     * lui-même, et les mêmes lecteurs suivent. Le relevé de la carte est oublié — il ne décrit plus
     * ces listes — sans que les ensembles soient jetés, puisqu'ils viennent d'être republiés.
     */
    adoptCpuCut(wanted: readonly PageRec[], shown: readonly PageRec[]) {
      run.cutEpoch++;
      cutDelta.adoptRecords(wanted);
      publishCut(cutDelta);
      drawnDelta.adoptRecords(shown);
      publishDrawn(drawnDelta);
      cutAdopter.forgetReadback();
    },
    /** Le relevé tenu ne décrit plus les listes de l'image : la suivante le relira en entier. */
    forgetReadback: () => (run.cutEpoch++, cutAdopter.forgetReadback()),
  };
}
