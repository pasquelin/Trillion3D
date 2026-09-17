import type { PageRec } from './pageSelection.ts';
import { createCutDelta } from './webgpuCutDelta.ts';
import { createCutCounts, type CutCounts } from './webgpuCutCounts.ts';
import { createCutPending, type CutPending } from './webgpuCutPending.ts';
import { createWebgpuCutAdopter } from './webgpuCutAdoption.ts';
import { markDrawnMirrored } from './webgpuPagesHelpers.ts';
import type { WebgpuResidencySets } from './webgpuResidencySets.ts';
import type { WebgpuPagesCore } from './webgpuPagesRuntime.ts';

/**
 * Ce que le journal des rangs prévient quand une page change de couverture. Posé hors de la
 * publication pour ne rien capturer d'autre que les deux compteurs qu'il touche : le journal le
 * garde aussi longtemps que le moteur, et une fermeture prise dans la publication y retiendrait
 * tout son contexte.
 */
const coverageWatcher = (counts: CutCounts, pending: CutPending) => (page: number) => {
  counts.touch(page);
  pending.touch(page);
};

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
    { rows, packedPages } = rt.layout;
  const cutDelta = createCutDelta(packedPages, run.desired);
  // La coupe dessinable écrit ses fiches elle-même, en lisant sa suite une seule fois : `run.shown`
  // n'en est plus qu'une recopie, et seulement quand l'image adopte le relevé qui l'a produite.
  const drawnPages: PageRec[] = [];
  const drawnDelta = createCutDelta(packedPages, drawnPages);
  const cutCounts = createCutCounts(packedPages, rows.residentOffsetWords, drawnDelta);
  const cutPending = createCutPending(packedPages, cutDelta);
  // Les trois façons dont la couverture d'une grappe bascule — octets reçus, octets rendus, place de
  // cache prise ou rendue — passent toutes par le journal des rangs, qui les nomme une à une.
  rows.watchTouched(coverageWatcher(cutCounts, cutPending));
  const publishCut = () => {
    residencySets.applyCut(cutDelta);
    cutPending.apply();
  };
  const publishDrawn = () => {
    residencySets.applyDrawn(drawnDelta);
    cutCounts.apply();
  };
  // Readback describes submitted work and future streaming requests. It never
  // decides the cut drawn for a moving camera; the current GPU mask does that.
  const cutAdopter = createWebgpuCutAdopter({
    selection: () => run.gpuSelection,
    desired: run.desired,
    shown: run.shown,
    drawn: run.drawn,
    uniforms: run.selectionUniforms,
    counts: cutCounts,
    delta: cutDelta,
    drawnDelta,
    drawnPages,
    onDrawnDelta: publishDrawn,
    onDrawnMirrored: () => markDrawnMirrored(run),
    onCutDelta: () => {
      publishCut();
      run.pagesEntered = cutDelta.enteredCount;
      run.pagesExited = cutDelta.exitedCount;
    },
  });
  // Before the first readback the image asks the cache for the pinned cover and nothing else.
  // Lu ici et non retenu : la portée de cette publication vit aussi longtemps que le moteur, et une
  // liste qui ne sert qu'à l'amorçage n'a pas à y rester accrochée.
  cutDelta.adoptRecords(rt.layout.gpuWanted);
  publishCut();
  /** Adopte le relevé et dit si l'IMAGE en est changée : si les listes affichées ont été réécrites.
   *  Un relevé neuf republiant les mêmes identifiants dans le même ordre n'en réécrit aucune. */
  const adoptGpuCut = () => {
    const adopted = cutAdopter.adopt(),
      metrics = cutAdopter.metrics;
    run.cutHeld = metrics.cutHeld;
    gpu.cutIncomplete = metrics.incomplete;
    gpu.cutTruncated = metrics.truncated;
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
     * lui-même, et les mêmes lecteurs suivent. Appelée une fois par image qui dessine, et seulement
     * une fois ses gardes passées : ce qu'elle pose, l'image le tient. L'appelant a déjà oublié le
     * relevé et fait vieillir les listes avant de choisir — c'est lui qui couvre la sortie par
     * erreur de la coupe, comme il le fait pour la recopie de `drawn` —, donc rien de tout cela
     * n'est refait ici. La republier telle quelle ne change rien : la différence est vide.
     */
    adoptCpuCut(wanted: readonly PageRec[], shown: readonly PageRec[]) {
      cutDelta.adoptRecords(wanted);
      publishCut();
      drawnDelta.adoptRecords(shown);
      publishDrawn();
    },
    /** Le relevé tenu ne décrit plus les listes de l'image : la suivante le relira en entier. */
    forgetReadback: () => (run.cutEpoch++, cutAdopter.forgetReadback()),
  };
}
