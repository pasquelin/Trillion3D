import type * as THREE from 'three';
import { projectBoxesFlat, splitOccludersFlat } from './hiz.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const viewportScratch: [number, number] = [1, 1];

/** Reuses the previous occluder half or splits projected bounds when history cannot partition.
 *  Writes the partition and projection timings into `rt.timing`. */
export function partitionWebgpuVisibility(rt: WebgpuPagesRuntime, camera: THREE.PerspectiveCamera) {
  const { layout, run, vis, timing } = rt,
    { rows, boxCorners, hizBounds, hizProjection, hizRest } = layout,
    { drawnOccluderUrls, urlIndexOfPage } = layout;
  const hasHiz = !!vis.gpuHiz,
    hasRestPipeline = !!vis.visHizRestBack;
  viewportScratch[0] = rt.gpu.targetSize[0];
  viewportScratch[1] = rt.gpu.targetSize[1];
  let occluders = 0,
    twoPass = false,
    boundsForAll = false;
  const worldBoxes = {
    corners: boxCorners,
    pageIndex: rows.packedPageIndex,
    epoch: rows.tableEpoch,
  };
  // Only the rectangles the view or the row table moved under are reprojected; the rest stand.
  hizProjection.reframe(camera, viewportScratch[0], viewportScratch[1], rows.tableEpoch);
  // La projection se chronomètre elle-même, dans les deux branches : la moitié testée seule, ou
  // toutes les boîtes quand l'historique ne partage rien. Sans cela le second cas se déposait sur la
  // partition, et une caméra mobile — qui n'emprunte que lui — n'aurait montré aucune projection.
  let projectMs = 0,
    rectangles = 0;
  const project = (only: Uint8Array | undefined) => {
    const start = performance.now();
    const besoin = hizProjection.select(rows.packedCount, only, rows.packedPageIndex);
    rectangles += besoin;
    if (besoin)
      projectBoxesFlat(
        rows.packedRecs,
        rows.packedCount,
        camera,
        viewportScratch,
        hizBounds,
        hizProjection.pending,
        worldBoxes,
      );
    hizProjection.keep(rows.packedCount, rows.packedPageIndex);
    projectMs += performance.now() - start;
  };
  const partitionStart = performance.now();
  const noHistory = run.noOccluderHistory;
  let historyOccluders = 0;
  hizRest.fill(0, 0, rows.packedCount);
  if (hasHiz && rows.packedCount >= 2) {
    if (!run.noOccluderHistory)
      for (let i = 0; i < rows.packedCount; i++) {
        const rest = drawnOccluderUrls[urlIndexOfPage[rows.packedPageIndex[i]]] ? 0 : 1;
        hizRest[i] = rest;
        if (!rest) occluders++;
      }
    historyOccluders = occluders;
    // Without history, or when history keeps or rejects every page, split on projected bounds.
    if (run.noOccluderHistory || !occluders || occluders === rows.packedCount) {
      project(undefined);
      occluders = splitOccludersFlat(rows.packedCount, hizBounds, hizRest);
      boundsForAll = true;
    }
    twoPass = occluders > 0 && occluders < rows.packedCount && hasRestPipeline;
  }
  if (!twoPass) {
    hizRest.fill(0, 0, rows.packedCount);
    occluders = rows.packedCount;
  }
  // Only the tested half needs a screen rectangle, and the history branch has projected nothing yet.
  if (twoPass && !boundsForAll) project(hizRest);
  // La moitié testée, hachée dans l'ordre des lignes, avec le nombre d'occulteurs ET l'âge des
  // rectangles d'écran : c'est, en dehors de la table de lignes, tout ce dont les fiches de dessin
  // et les bornes projetées dépendent.
  //
  // L'âge de projection en fait partie parce que les bornes envoyées au test Hi-Z sont des
  // rectangles d'ÉCRAN : une caméra qui bouge sans changer la partition des pages les réécrit
  // toutes. Sans lui, l'image testait les rectangles de la caméra précédente et pouvait rejeter à
  // tort des surfaces visibles.
  let restSignature = (occluders * 31 + hizProjection.generation) | 0;
  for (let i = 0; i < rows.packedCount; i++) restSignature = (restSignature * 31 + hizRest[i]) | 0;
  timing.lastProjectMs = projectMs;
  timing.lastPartitionMs = performance.now() - partitionStart - projectMs;
  const counts = timing.partitionCounts;
  counts.lignes = rows.packedCount;
  counts.occulteurs = occluders;
  counts.testees = twoPass ? rows.packedCount - occluders : 0;
  // 1 quand l'historique n'a rien partagé et que toutes les boîtes ont dû être projetées.
  counts.bornesToutes = boundsForAll ? 1 : 0;
  counts.historiqueOcculteurs = historyOccluders;
  counts.sansHistorique = noHistory ? 1 : 0;
  // Combien de rectangles d'écran cette image a dû réécrire : zéro quand le cache décrit déjà la
  // vue. C'est ce qui rend observable, du dehors, qu'une vue nouvelle — un rig d'hôte déplacé, par
  // exemple — retire bien les rectangles tenus, et qu'une vue immobile ne les retire pas.
  counts.rectanglesProjetes = rectangles;
  return { occluders, twoPass, restSignature };
}
