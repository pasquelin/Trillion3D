import { SELECTION_WORKGROUP as WORKGROUP } from './gpuSelection.ts';
import { ESCALATION_ROUNDS } from './pageSelectionTypes.ts';
import type { createDagResources } from './gpuDagResources.ts';

type DagResources = NonNullable<Awaited<ReturnType<typeof createDagResources>>>;

/**
 * Les noyaux de la coupe, encodés dans l'ordre. Chaque lancement attend le précédent — la carte vide
 * sa file et ses caches entre deux —, et cette attente ne s'attribue à aucun noyau : c'est le nombre
 * de lancements qui la fixe, pas leur taille. Il n'en reste donc que ce que les dépendances exigent
 * vraiment : la préparation porte les seuils, les plans et les comptes de bloc d'un seul coup, le
 * compte de groupes de la liste vivante se tient au fil des ajouts, et le masque compte lui-même les
 * dessinées de son bloc.
 *
 * Deux passes et non une : le compte de groupes vit dans `work`, écrit par la première passe et lu
 * comme argument de répartition par la seconde, et WebGPU refuse un tampon à la fois écrit et lu
 * comme argument dans une même portée de synchronisation. La coupure ne porte que la recopie de ce
 * mot ; les deux autres mots de l'argument valent un et ne changent jamais.
 */
export function encodeDagKernels(encoder: GPUCommandEncoder, resources: DagResources) {
  // Une variante de DIAGNOSTIC seule réencode la coupe. La répétition PRÉCÈDE la coupe qui compte :
  // chaque noyau repart de la remise à zéro, l'état final est donc celui d'une exécution unique, et
  // l'écart d'image mesure ce que la répétition a vraiment coûté — attentes entre lancements
  // comprises, que nulle enveloppe de passe ne rapporte.
  if (resources.repeat) encodeOnce(encoder, resources, resources.repeat === 'tete');
  encodeOnce(encoder, resources);
}

function encodeOnce(encoder: GPUCommandEncoder, resources: DagResources, headOnly = false) {
  const {
    residentCut,
    pageCount,
    nodeCount,
    worldCount,
    blockCount,
    liveGroupsOffset,
    work,
    liveArgs,
    bindGroup,
    preparePipeline,
    nodePipeline,
    wantedPipeline,
    escalatePipeline,
    checkPipeline,
    maskPipeline,
    drawPrefixPipeline,
    drawScatterPipeline,
  } = resources;
  const groups = (count: number) => Math.max(1, Math.ceil(count / WORKGROUP));
  const pass = encoder.beginComputePass({ label: 'WG DAG selection' });
  pass.setBindGroup(0, bindGroup);
  const run = (pipeline: GPUComputePipeline, count: number) => {
    pass.setPipeline(pipeline);
    pass.dispatchWorkgroups(groups(count));
  };
  run(preparePipeline, Math.max(worldCount, blockCount));
  run(nodePipeline, Math.max(1, nodeCount));
  run(wantedPipeline, pageCount);
  pass.end();
  if (headOnly) return;
  // Le mot de tête de l'argument de répartition, recopié hors passe vers son propre tampon : les
  // deux autres y valent un depuis sa création. C'est la seule raison de la coupure entre les passes.
  encoder.copyBufferToBuffer(work, liveGroupsOffset, liveArgs, 0, 4);
  const live = encoder.beginComputePass({ label: 'WG DAG selection' });
  live.setBindGroup(0, bindGroup);
  // Ces noyaux ne visitent que les grappes vivantes, celles que `dagWanted` vient de lister :
  // leur verdict est celui d'avant, il n'est plus prononcé sur celles dont il ne disait rien.
  const runLive = (pipeline: GPUComputePipeline) => {
    live.setPipeline(pipeline);
    live.dispatchWorkgroupsIndirect(liveArgs, 0);
  };
  if (residentCut) {
    for (let round = 0; round < ESCALATION_ROUNDS; round++) runLive(escalatePipeline);
    runLive(checkPipeline);
  }
  runLive(maskPipeline);
  // La liste des pages dessinables est compactée ici, dans l'ordre croissant : le relevé ne
  // rapporte plus un drapeau par page mais le seul compte et ses rangs.
  if (residentCut) {
    live.setPipeline(drawPrefixPipeline);
    live.dispatchWorkgroups(1);
    live.setPipeline(drawScatterPipeline);
    live.dispatchWorkgroups(groups(pageCount));
  }
  live.end();
}
