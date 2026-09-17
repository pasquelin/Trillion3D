// Les deux tours d'une scène du banc « transparents en quelques ordres », et ce qu'ils comptent.
//
// Chaque scène a les siens : un tour partagé entre deux scènes est un site d'appel polymorphe, et
// le chronomètre le paie. De même, chaque boucle est dans la fonction où le moteur la tient — une
// boucle écrite en ligne dans le tour ralentit les autres, à travail strictement identique.
import { orderBlendPasses } from '../webgpuBlendOrder.ts';
import { expandBlendPlan, itemKept } from '../webgpuBlendExpandCpu.ts';
import { RUN_SHARED, RUN_WORDS, runOwner } from '../webgpuBlendRuns.ts';
import { pose, spans } from './scenesTransparents.mjs';
import {
  argumentsReference,
  classementReference,
  encodeReference,
} from './oracles/transparents-ordres.mjs';

/** Ce que la boucle d'encodage a compté sur le dernier tour : lu par le relevé, pas par le tour. */
let comptes = 0;
export const appelsEncodes = () => comptes;

/**
 * LA BOUCLE D'ENCODAGE, comptée : une tranche qui nomme son item et que le tronc rejette n'est pas
 * encodée, une tranche qui en fusionne plusieurs l'est toujours (`webgpuBlendDraw.ts`).
 *
 * Elle est dans SA fonction, comme dans le moteur, où elle vit dans la passe de dessin et non dans
 * le classement. Écrite en ligne dans le tour, elle ralentissait le tri que le tour appelle et que
 * la boucle ne touche pas : de +7,6 % à −7,6 % sur le saut de caméra double face, à travail
 * strictement identique. Un banc qui mesure autre chose que la forme livrée ne mesure rien.
 */
function compteAppels(blendState) {
  const runs = blendState.runsBlend,
    order = blendState.orderBlend,
    keep = blendState.keepPacked,
    count = blendState.runCount[0];
  let encodes = 0;
  for (let run = 0; run < count; run++) {
    const at = run * RUN_WORDS,
      owner = runOwner(order[runs[at]], runs[at + 1]);
    if (owner === RUN_SHARED || itemKept(keep, owner)) encodes++;
  }
  return encodes;
}

/** L'étalement du repli processeur, relu en plages d'indices : ce que le rasteriseur verrait. */
function etale(blendState, miroir, sortie) {
  const items = blendState.blendGpu;
  const instances = expandBlendPlan({
    order: blendState.orderBlend,
    runs: blendState.runsBlend,
    runCount: blendState.runCount[0],
    draws: blendState.drawsPacked,
    keep: blendState.keepPacked,
    itemCounts: blendState.cpuItemCounts,
    instances: blendState.cpuInstances,
    maxVertexWords: blendState.maxVertexWords,
    vertexShift: blendState.vertexShift,
    instanceBase: 0,
    argsBase: 0,
    expanded: miroir.expanded,
    args: miroir.args,
  });
  let at = 0;
  for (let i = 0; i < instances; i++) {
    const item = miroir.expanded[i * 2],
      cle = miroir.expanded[i * 2 + 1];
    sortie[at++] = item;
    sortie[at++] = items[item].paged ? spans[cle * 2] : cle;
    sortie[at++] = items[item].paged ? spans[cle * 2 + 1] : items[item].count - cle;
  }
  return at;
}

/** Les quatre tours d'une scène, et les miroirs du repli processeur alloués hors tour. */
export function tours(avant, apres) {
  const blendState = apres.blendState;
  const miroir = {
    expanded: new Uint32Array(blendState.instanceCapacity * 2),
    args: new Uint32Array(blendState.maxPlanEntries * 8),
  };
  /** Le chemin d'avant : classement, arguments de tous les items, un appel par entrée. */
  const reference = (images, sequence) => {
    const sortie = [];
    for (const image of images) {
      pose(avant, image);
      classementReference(avant.scene, avant.order, image.eye);
      argumentsReference(avant.scene, avant.args);
      const rendu = encodeReference(avant.scene, avant.order, avant.args, avant.sortie);
      sortie.push(sequence ? avant.sortie.subarray(0, rendu.length) : rendu.rejected);
    }
    return sortie;
  };
  /** Le chemin du lot : classement, tronc et tranches, puis un appel par tranche. */
  const optimisee = (images, sequence) => {
    const sortie = [];
    for (const image of images) {
      pose(apres, image);
      const rejets = orderBlendPasses(blendState, image.eye);
      if (sequence) {
        sortie.push(apres.sortie.subarray(0, etale(blendState, miroir, apres.sortie)));
        continue;
      }
      comptes = compteAppels(blendState);
      sortie.push(rejets);
    }
    return sortie;
  };
  return {
    tourAvant: (images) => reference(images, false),
    tourApres: (images) => optimisee(images, false),
    tourAvantSeq: (images) => reference(images, true),
    tourApresSeq: (images) => optimisee(images, true),
  };
}
