import type { WebgpuRunState } from './webgpuPagesStateRun.ts';
import {
  UNTEXTURED_MATERIALS,
  VIS_FEATURES,
  type WebgpuPagesRuntime,
} from './webgpuPagesRuntime.ts';

/**
 * La pyramide temporelle ne décrit plus cette image. Elle n'est relue que pour une vue identique au
 * bit près, donc un mouvement de caméra la retire ; l'historique des occulteurs, lui, ne nomme que
 * des pages et ne dépend d'aucune vue.
 */
export function invalidateTemporalPyramid(run: WebgpuRunState) {
  run.temporalHizState.pyramid = undefined;
  run.temporalHizState.camera = undefined;
}

/** Ni les occulteurs de l'image précédente ni sa pyramide ne décrivent celle-ci. */
export function invalidateOccluderHistory(run: WebgpuRunState) {
  run.noOccluderHistory = true;
  invalidateTemporalPyramid(run);
}

/** A capability now served: it leaves the list of what the backend declares unsupported. */
export function grantCapability(capabilities: WebgpuPagesRuntime['capabilities'], item: string) {
  capabilities.unsupported = capabilities.unsupported.filter((entry) => entry !== item);
}

export function resetHizHistory(run: WebgpuRunState) {
  invalidateOccluderHistory(run);
  run.previousHizView = undefined;
  run.temporalHizState.viewport = undefined;
}

/**
 * Le repli sur la coupe processeur, annoncé. La sélection GPU n'est abandonnée que sur un échec
 * réel — capacité des identifiants, envoi en erreur, encodage perdu, relevé en échec —, jamais
 * parce qu'une page voulue n'est pas encore arrivée. Un banc qui mesurerait la coupe processeur en
 * croyant mesurer la coupe GPU le lit dans `gpuSelectionFallback` et dans ce diagnostic, émis une
 * seule fois par session.
 */
export function fallbackToCpuCut(
  rt: WebgpuPagesRuntime,
  reason: string,
  details: Record<string, unknown> = {},
) {
  if (!rt.gpu.selectionFallback) {
    rt.gpu.selectionFallback = true;
    rt.diag.engineDiagnostic(
      'gpu-selection-fallback',
      'Avertissement : sélection GPU abandonnée, la coupe processeur dessine désormais',
      { reason, ...details },
    );
  }
  dropGpuSelection(rt);
}

export function dropGpuSelection(rt: WebgpuPagesRuntime) {
  // Origine du changement de ressources : la sélection par la carte n'est plus une capacité de ce
  // moteur, et l'image suivante refait sa coupe sans elle.
  rt.run.gate.resourcesChanged();
  rt.run.gpuSelection?.dispose();
  rt.run.gpuSelection = undefined;
  rt.capabilities.gpuDriven = false;
}

/** La partition vit avec la pyramide et la compaction : elle écrit dans l'une et lit dans l'autre. */
function dropGpuPartition(rt: WebgpuPagesRuntime) {
  // Le test d'occultation des transparents lit l'uniforme de la partition : il part avec elle, et
  // la table transparente retrouve toutes ses entrées.
  rt.blendState.occlusion?.dispose();
  rt.blendState.occlusion = undefined;
  rt.blendState.occlusionEpoch = -1;
  rt.vis.gpuPartition?.dispose();
  rt.vis.gpuPartition = undefined;
  rt.run.occluderHistoryEpoch = -1;
}

export function dropGpuHiz(rt: WebgpuPagesRuntime) {
  const { vis } = rt;
  dropGpuPartition(rt);
  vis.gpuHiz?.dispose();
  vis.gpuHiz = undefined;
  vis.visHizBindGroup = undefined;
  vis.visHizRestBack = undefined;
  vis.visHizRestNone = undefined;
  vis.visHizRestFront = undefined;
  resetHizHistory(rt.run);
}

function dropGpuDraw(rt: WebgpuPagesRuntime) {
  dropGpuPartition(rt);
  // La compaction de la moitié testée ne nomme que les tampons de la compaction de dessin.
  rt.vis.gpuRestCompact?.dispose();
  rt.vis.gpuRestCompact = undefined;
  rt.vis.gpuDraw?.dispose();
  rt.vis.gpuDraw = undefined;
  if (!rt.capabilities.unsupported.includes('indirect draw'))
    rt.capabilities.unsupported.push('indirect draw');
}

export function dropVis(rt: WebgpuPagesRuntime) {
  const { vis, capabilities } = rt,
    { rows, drawSlots } = rt.layout;
  // Origine du changement de ressources : le tampon de visibilité n'est plus une capacité.
  rt.run.gate.resourcesChanged();
  vis.visEnabled = false;
  vis.visPipelineBack = undefined;
  vis.visPipelineBackCw = undefined;
  vis.visPipelineNone = undefined;
  vis.visPipelineFront = undefined;
  vis.visPipelineFrontCw = undefined;
  vis.visLayerPipelines.length = 0;
  vis.drawLayerSlots = 1;
  vis.shadePipeline = undefined;
  vis.shadeBindGroup = undefined;
  vis.shadeBindGroupLayout = undefined;
  vis.visBindGroupLayout = undefined;
  vis.visBindGroup = undefined;
  vis.visHizBindGroup = undefined;
  vis.mapsSampler = undefined;
  vis.blendBindGroupLayout = undefined;
  vis.pipelineBlendTextured = undefined;
  vis.pipelineBlendFront = undefined;
  vis.pipelineBlendBack = undefined;
  for (const item of rt.blendState.blendGpu) item.group = undefined;
  rt.blendState.overdraw?.dispose();
  rt.blendState.overdraw = undefined;
  vis.gpuSmall?.dispose();
  vis.gpuSmall = undefined;
  dropGpuDraw(rt);
  dropGpuHiz(rt);
  vis.concatPos?.destroy();
  vis.concatUv?.destroy();
  vis.concatNrm?.destroy();
  vis.pageTable?.destroy();
  vis.shadeUniform?.destroy();
  vis.visUniform?.destroy();
  vis.zeroFlags?.destroy();
  vis.colorAtlas?.destroy();
  vis.dataAtlas?.destroy();
  vis.materialScales?.destroy();
  vis.materialScales = undefined;
  vis.visSlotGroups.fill(undefined);
  vis.smallGroups.fill(undefined);
  vis.concatPos =
    vis.concatUv =
    vis.concatNrm =
    vis.pageTable =
    vis.shadeUniform =
    vis.visUniform =
    vis.zeroFlags =
    vis.colorAtlas =
    vis.dataAtlas =
      undefined;
  vis.slots?.destroy();
  vis.slots = undefined;
  rows.pageTableFloats = undefined;
  rows.pageTableInts = undefined;
  rows.rowPageIndex.fill(-1);
  rows.rowOffsetWords.fill(-1);
  rows.rowEpoch.fill(0);
  rows.rowCount = 0;
  rows.dirtyFrom = drawSlots;
  rows.dirtyTo = -1;
  rows.candidateCount = 0;
  rows.packedCount = 0;
  rows.rowsChanged = true;
  capabilities.materials = UNTEXTURED_MATERIALS;
  vis.textureJobs.length = 0;
  for (const item of VIS_FEATURES)
    if (!capabilities.unsupported.includes(item)) capabilities.unsupported.push(item);
}
