// Lot « transparents en quelques ordres » : la passe de mélange n'encode plus un appel par item
// mais un par TRANCHE du plan trié. Référence = le code d'avant, recopié dans
// `oracles/transparents-ordres.mjs` (classement, arguments par item, encodage entrée par entrée).
//
// Deux lignes par régime, parce que les deux chemins ne paient pas la même chose :
//
// - « ordres et arguments » mesure ce que le PROCESSEUR paie par image sur un appareil à étage de
//   calcul : d'un côté le classement, la réécriture des arguments de tous les items et la boucle
//   qui encode entrée par entrée ; de l'autre le classement — tronc et tranches compris — et la
//   boucle qui encode tranche par tranche. L'étalement, lui, est à la carte.
// - « repli processeur » mesure l'appareil SANS étage de calcul, qui étale le plan lui-même. Les
//   deux côtés y rendent la suite complète des plages d'indices que le rasteriseur verrait, et
//   c'est cette suite-là qui prouve l'égalité, plage par plage et mot pour mot.
//
// Le nombre d'appels de dessin, lui, n'est pas un temps : il est compté et vérifié à part, en fin
// de fichier, là où il se lit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { orderBlendPasses } from '../webgpuBlendOrder.ts';
import { expandBlendPlan } from '../webgpuBlendExpandCpu.ts';
import { compare, verifieEtDepose } from '../../sdk-core/bench/banc.mjs';
import { cote, glisse, ITEMS, pose, regimes, spans } from './scenesTransparents.mjs';
import {
  argumentsReference,
  classementReference,
  encodeReference,
} from './oracles/transparents-ordres.mjs';

const referenceEtat = cote(),
  optimiseeEtat = cote();
/** Ce que la boucle d'encodage a compté sur le dernier tour : lu plus bas, jamais perdu en route. */
let appelsEncodes = 0;

/** Le chemin d'avant : classement, arguments de tous les items, un appel par entrée. */
function tourReference(images, sequence) {
  const etat = referenceEtat,
    sortie = [];
  for (const image of images) {
    pose(etat, image);
    classementReference(etat.scene, etat.order, image.eye);
    argumentsReference(etat.scene, etat.args);
    const rendu = encodeReference(etat.scene, etat.order, etat.args, etat.sortie);
    sortie.push(sequence ? etat.sortie.subarray(0, rendu.length) : rendu.rejected);
  }
  return sortie;
}

/** Le chemin du lot : classement, tronc et tranches, puis un appel par tranche. */
function tourOptimisee(images, sequence) {
  const etat = optimiseeEtat,
    blendState = etat.blendState,
    sortie = [];
  for (const image of images) {
    pose(etat, image);
    const rejets = orderBlendPasses(blendState, image.eye);
    if (sequence) {
      sortie.push(etat.sortie.subarray(0, etale(blendState, etat.sortie)));
      continue;
    }
    appelsEncodes = 0;
    for (let run = 0; run < blendState.runCount[0]; run++)
      if (blendState.runKept[0][run]) appelsEncodes++;
    sortie.push(rejets);
  }
  return sortie;
}

/** Les deux miroirs que le repli processeur écrit : le banc les tient, comme l'appareil les tient. */
const miroirs = new Map();
const miroirDe = (blendState) => {
  if (!miroirs.has(blendState))
    miroirs.set(blendState, {
      expanded: new Uint32Array(blendState.instanceCapacity * 2),
      args: new Uint32Array(blendState.maxPlanEntries * 8),
    });
  return miroirs.get(blendState);
};

/** L'étalement du repli processeur, relu en plages d'indices : ce que le rasteriseur verrait. */
function etale(blendState, sortie) {
  const items = blendState.blendGpu,
    miroir = miroirDe(blendState);
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
  const liste = miroir.expanded;
  let at = 0;
  for (let i = 0; i < instances; i++) {
    const item = liste[i * 2],
      cle = liste[i * 2 + 1];
    sortie[at++] = item;
    sortie[at++] = items[item].paged ? spans[cle * 2] : cle;
    sortie[at++] = items[item].paged ? spans[cle * 2 + 1] : items[item].count - cle;
  }
  return at;
}

const casDe = (images) => [
  { nom: `8 images de ${ITEMS} items`, entree: images, taille: ITEMS * 8 },
];
const lignes = [];
for (const [regime, images] of regimes) {
  lignes.push(
    await compare({
      calcul: `GEO-2 ordres et arguments — ${regime}`,
      fichier: 'packages/sdk-browser/webgpuBlendDraw.ts',
      cas: casDe(images),
      reference: (entree) => tourReference(entree, false),
      optimisee: (entree) => tourOptimisee(entree, false),
      options: { tours: 40, budgetMs: 3000, alterne: true },
    }),
  );
  lignes.push(
    await compare({
      calcul: `GEO-2 repli processeur — ${regime}`,
      fichier: 'packages/sdk-browser/webgpuBlendExpandCpu.ts',
      cas: casDe(images),
      reference: (entree) => tourReference(entree, true),
      optimisee: (entree) => tourOptimisee(entree, true),
      options: { tours: 20, budgetMs: 3000, alterne: true },
    }),
  );
}

/**
 * LE NOMBRE D'APPELS DE DESSIN, avant et après, sur la même image : c'est le gain du lot, et il se
 * compte, il ne se chronomètre pas. Les items paginés partagent un pipeline, donc une tranche ; une
 * primitive qui porte ses propres tampons garde son appel et coupe la tranche de ses voisines.
 */
test('GEO-2 : la passe transparente encode quelques ordres au lieu de quelques milliers', () => {
  const image = glisse[0];
  pose(referenceEtat, image);
  classementReference(referenceEtat.scene, referenceEtat.order, image.eye);
  argumentsReference(referenceEtat.scene, referenceEtat.args);
  const avant = encodeReference(
    referenceEtat.scene,
    referenceEtat.order,
    referenceEtat.args,
    referenceEtat.sortie,
  );
  tourOptimisee([image], false);
  const apres = appelsEncodes;
  const gain = (((avant.encoded - apres) / avant.encoded) * 100).toFixed(1);
  console.log(
    `| GEO-2 appels de dessin transparents | \`webgpuBlendDraw.ts\` | ${avant.encoded} | ${apres} | ${gain} % | oui | oui |`,
  );
  assert.ok(apres < avant.encoded / 100, `${apres} ordres pour ${avant.encoded} appels`);
});

verifieEtDepose(
  'transparents-ordres',
  'GEO-2 : les deux chemins peignent les mêmes plages, dans le même ordre',
  lignes,
);
