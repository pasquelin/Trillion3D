// L'ÉTALEMENT DU PLAN TRANSPARENT, RÉELLEMENT EXÉCUTÉ SUR LA CARTE.
//
// Le lot « transparents en quelques ordres » a deux implémentations d'une seule sémantique : le
// noyau WGSL (`webgpuBlendExpandWgsl.ts`), que la production emploie, et le modèle processeur
// (`webgpuBlendExpandCpu.ts`), qui sert de repli aux appareils sans étage de calcul et d'oracle
// partout ailleurs — le double de test le rejoue, et le banc le compare au chemin d'avant.
//
// Rien de tout cela ne prouve que le NOYAU dit la même chose. Ce script l'exécute pour de vrai dans
// Chromium WebGPU, sur les mêmes entrées que le modèle, et compare les deux sorties mot pour mot :
// la liste d'instances étalée et l'argument indirect de chaque tranche.
//
// LAB_ROOT=… node --experimental-strip-types \
//   test/justesse/etalement-transparents-gpu.mjs
import assert from 'node:assert/strict';
import { expandBlendPlan } from '../../packages/sdk-browser/webgpuBlendExpandCpu.ts';
import {
  blendExpandUniform,
  buildBlendRuns,
  EXPAND_GROUP,
  RUN_WORDS,
  UNI_WORDS,
} from '../../packages/sdk-browser/webgpuBlendRuns.ts';
import {
  BLEND_EXPAND_ENTRIES,
  BLEND_EXPAND_SHADER,
  blendExpandDispatch,
  STORAGE_TYPES,
} from '../../packages/sdk-browser/webgpuBlendExpandWgsl.ts';
import { DRAW_UNPAGED, planEntry } from '../../packages/sdk-browser/webgpuBlendPlan.ts';
import { etalementGpu } from './noyauEtalementGpu.mjs';
import { graine } from '../../packages/sdk-core/bench/socle.mjs';

const alea = graine(1789);
const MOTS = 48,
  GRAPPES = 6;

/**
 * Un cas : des items paginés qui partagent une tranche, des primitives qui portent leurs propres
 * tampons et coupent la tranche, un tronc qui en rejette une partie, et assez d'entrées pour que
 * plusieurs paquets de comptage se suivent — c'est là que la somme courante se prouve.
 */
function cas(items, isoles, base) {
  const draws = new Uint32Array(items * 4),
    counts = new Uint32Array(items),
    clusters = new Uint32Array(items * GRAPPES),
    keep = new Uint32Array((items + 31) >> 5);
  for (let item = 0; item < items; item++) {
    const isole = isoles.includes(item);
    draws[item * 4] = isole ? DRAW_UNPAGED : item;
    draws[item * 4 + 1] = isole ? 1 + Math.floor(alea() * 4) : GRAPPES;
    draws[item * 4 + 2] = item * GRAPPES;
    draws[item * 4 + 3] = isole ? 3 * (1 + Math.floor(alea() * 5)) : 0;
    counts[item] = Math.floor(alea() * (GRAPPES + 1));
    for (let j = 0; j < GRAPPES; j++) clusters[item * GRAPPES + j] = 7000 + item * GRAPPES + j;
    if (alea() < 0.8) keep[item >> 5] |= 1 << (item & 31);
  }
  // Le plan trié : l'ordre de peinture, avec le bit de partage et le pipeline dans les bits bas.
  const order = new Uint32Array(items);
  for (let i = 0; i < items; i++) {
    const item = (items - 1 - i + 17) % items;
    order[i] = planEntry(item, i % 3 === 0 ? 2 : 1, !isoles.includes(item));
  }
  // Le découpage en tranches est celui de la PRODUCTION, pas une copie : une preuve « carte =
  // modèle » qui rejouerait son propre découpeur ne prouverait plus rien du chemin livré.
  const runs = new Uint32Array(items * RUN_WORDS);
  const count = buildBlendRuns(order, true, runs);
  // Le compte indirect que la compaction écrit : quatre mots par item, le compte au deuxième.
  const indirect = new Uint32Array(items * 4);
  for (let item = 0; item < items; item++) indirect[item * 4 + 1] = counts[item];
  return { items, draws, keep, counts, indirect, clusters, order, runs, runCount: count, base };
}

/** Le modèle processeur, sur les mêmes entrées : c'est lui que le noyau doit répéter. */
function attendu(entree, instanceWords, argsWords) {
  const expanded = new Uint32Array(instanceWords),
    args = new Uint32Array(argsWords);
  expandBlendPlan({
    order: entree.order,
    runs: entree.runs,
    runCount: entree.runCount,
    draws: entree.draws,
    keep: entree.keep,
    itemCounts: entree.counts,
    instances: entree.clusters,
    maxVertexWords: MOTS,
    vertexShift: 6,
    instanceBase: entree.base.instances,
    argsBase: entree.base.args,
    expanded,
    args,
  });
  return { expanded, args };
}

/** Les douze mots d'uniforme, posés par l'écrivain de production : une seule disposition. */
const uniformeDe = (entree) =>
  Array.from(
    blendExpandUniform(
      new Uint32Array(UNI_WORDS),
      { entries: entree.order.length, runs: entree.runCount, instanceBase: entree.base.instances },
      { order: 0, runs: entree.order.length, args: entree.base.args },
      { maxVertexWords: MOTS, vertexShift: 6 },
    ),
  );

const entrees = [
  cas(7, [3], { instances: 0, args: 0 }),
  cas(200, [11, 12, 90], { instances: 40, args: 32 }),
];
for (const entree of entrees) {
  const instanceWords = (entree.base.instances + entree.items * GRAPPES * 4) * 2;
  const argsWords = entree.base.args + entree.runCount * 4;
  const modele = attendu(entree, instanceWords, argsWords);
  const carte = await etalementGpu({
    code: BLEND_EXPAND_SHADER,
    uni: uniformeDe(entree),
    plan: Array.from(entree.order).concat(Array.from(entree.runs)),
    keep: Array.from(entree.keep),
    draws: Array.from(entree.draws),
    indirect: Array.from(entree.indirect),
    clusters: Array.from(entree.clusters),
    scratchWords: entree.order.length + Math.ceil(entree.order.length / EXPAND_GROUP),
    types: STORAGE_TYPES,
    noms: BLEND_EXPAND_ENTRIES,
    lancements: blendExpandDispatch([], entree.order.length, entree.runCount),
    uniBytes: UNI_WORDS * 4,
    instanceWords,
    argsWords,
  });
  assert.ok(carte, 'la page a bien ouvert un appareil WebGPU');
  assert.deepEqual(carte.compilation, [], 'le noyau compile sans erreur');
  assert.deepEqual(carte.expanded, Array.from(modele.expanded), 'la liste étalée, mot pour mot');
  assert.deepEqual(carte.args, Array.from(modele.args), 'les arguments indirects, mot pour mot');
  console.log(`étalement de ${entree.items} items en ${entree.runCount} tranches : carte = modèle`);
}
