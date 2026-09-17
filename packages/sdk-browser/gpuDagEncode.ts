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
 *
 * Cette recopie est CHÈRE — la mesure est auprès de `hierarchyLevelSizes` (`gpuDagHierarchy.ts`) —,
 * et il n'en reste que trois par image. Ce n'est pas que les trois listes concernées n'aient aucun
 * majorant : `pageCount` en est un pour toutes. C'est qu'il est GROSSIER, 1 959 792 pour 21 955
 * utiles sur le banc à douze instances, quand l'étage d'un niveau colle à sa file. Un armement
 * s'échange donc contre des fils, et le change ne vaut que si le majorant est serré.
 */
export function encodeDagKernels(encoder: GPUCommandEncoder, resources: DagResources) {
  // Une variante de DIAGNOSTIC seule réencode la coupe. La répétition PRÉCÈDE la coupe qui compte :
  // chaque noyau repart de la remise à zéro, l'état final est donc celui d'une exécution unique, et
  // l'écart d'image mesure ce que la répétition a vraiment coûté — attentes entre lancements
  // comprises, que nulle enveloppe de passe ne rapporte.
  if (resources.repeat) {
    encodeOnce(encoder, resources, resources.repeat === 'tete', true);
    encodeOnce(encoder, resources, false, false);
    return;
  }
  encodeOnce(encoder, resources, false, true);
}

function encodeOnce(
  encoder: GPUCommandEncoder,
  resources: DagResources,
  headOnly: boolean,
  clear: boolean,
) {
  const {
    residentCut,
    worldCount,
    blockCount,
    levelSizes,
    liveGroupsOffset,
    candGroupsOffset,
    drawnGroupsOffset,
    work,
    dispatchArgs,
    bindGroup,
    preparePipeline,
    clearDrawnPipeline,
    levelPipelines,
    wantedPipeline,
    escalatePipeline,
    checkPipeline,
    maskPipeline,
    drawPrefixPipeline,
    drawScatterPipeline,
  } = resources;
  const groups = (count: number) => Math.max(1, Math.ceil(count / WORKGROUP));
  // Le mot de tête de l'argument de répartition, recopié hors passe : les deux autres valent un
  // depuis la création du tampon. C'est la seule raison des coupures entre les passes.
  const arm = (offset: number) => encoder.copyBufferToBuffer(work, offset, dispatchArgs, 0, 4);
  const alone = (pipeline: GPUComputePipeline) => {
    const pass = encoder.beginComputePass({ label: 'WG DAG selection' });
    pass.setBindGroup(0, bindGroup);
    pass.setPipeline(pipeline);
    pass.dispatchWorkgroupsIndirect(dispatchArgs, 0);
    pass.end();
  };
  if (clear) arm(drawnGroupsOffset);
  const pass = encoder.beginComputePass({ label: 'WG DAG selection' });
  pass.setBindGroup(0, bindGroup);
  // Les dessinées de l'image précédente, et elles seules, reprennent leur drapeau à zéro : plus
  // aucun parcours de tous les drapeaux, et la préparation qui suit remet le journal à zéro.
  if (clear) {
    pass.setPipeline(clearDrawnPipeline);
    pass.dispatchWorkgroupsIndirect(dispatchArgs, 0);
  }
  pass.setPipeline(preparePipeline);
  pass.dispatchWorkgroups(groups(Math.max(worldCount, blockCount)));
  // Toute la descente dans CETTE passe : les lancements d'une même passe s'exécutent dans l'ordre et
  // voient ce que les précédents ont écrit — la préparation et la passe 0 en dépendaient déjà. Rien
  // d'autre ne coupait la descente que l'argument de répartition, et il n'y en a plus.
  //
  // La passe 0 part d'une racine par primitive. Son compte est `worldCount` et NON `levelSizes[0]`,
  // qui ne la majorerait pas toujours : `dagPrepare` pose une entrée par primitive, racine absente
  // comprise — la passe 0 l'y lit et la rejette —, là où l'étage zéro ne compte que les racines qui
  // existent. Une primitive dont l'appelant fournit une hiérarchie vide en ferait diverger les deux.
  pass.setPipeline(levelPipelines[0]);
  pass.dispatchWorkgroups(groups(worldCount));
  // Chaque niveau suivant ne lit que les nœuds que le précédent a retenus, et remplit la file
  // suivante des trois — celle qu'un niveau plus tôt a remise à zéro. Le compte lancé est celui des
  // nœuds de son étage, majorant connu du rangement.
  for (let level = 1; level < levelSizes.length; level++) {
    pass.setPipeline(levelPipelines[level % levelPipelines.length]);
    pass.dispatchWorkgroups(groups(levelSizes[level]));
  }
  pass.end();
  // Les pages des feuilles retenues, et elles seules : une page sous un nœud rejeté n'est pas lue.
  arm(candGroupsOffset);
  alone(wantedPipeline);
  if (headOnly) return;
  arm(liveGroupsOffset);
  const live = encoder.beginComputePass({ label: 'WG DAG selection' });
  live.setBindGroup(0, bindGroup);
  // Ces noyaux ne visitent que les grappes vivantes, celles que `dagWanted` vient de lister :
  // leur verdict est celui d'avant, il n'est plus prononcé sur celles dont il ne disait rien.
  const runLive = (pipeline: GPUComputePipeline) => {
    live.setPipeline(pipeline);
    live.dispatchWorkgroupsIndirect(dispatchArgs, 0);
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
    runLive(drawScatterPipeline);
  }
  live.end();
}
