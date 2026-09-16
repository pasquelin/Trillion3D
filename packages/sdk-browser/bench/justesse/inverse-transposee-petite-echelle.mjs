// Défaut 6 : dans `inverseTranspose3` (gpuDagShader.ts), le garde `abs(det)<1e-20` rendait l'axe
// LOCAL non transformé au lieu de l'inverse-transposée dès qu'une échelle uniforme assez petite
// (det = ±s³ < 1e-20, soit s ≲ 2,15e-7) rendait le déterminant minuscule. Le test de conformité
// (défaut 1) étant, lui, indépendant de l'échelle, une rotation d'échelle minuscule était jugée
// conforme des deux côtés et seul le GPU prenait le raccourci : il comparait l'axe non tourné à la
// caméra comme s'il était déjà en repère monde, et supprimait des faces pourtant de face.
//
// Ce script exécute réellement le noyau WGSL dans Chromium WebGPU, deux fois sur les mêmes cas :
// la version corrigée telle qu'elle est livrée, et la version AVANT reconstruite par
// `substitutionAvant.mjs`, qui établit la substitution au lieu de l'espérer.
//
// DEUX POPULATIONS SOUS UN MÊME MOT. « 560 suppressions avant, 54 après » ne prouve rien tout seul :
// supprimer une face peut être CORRECT (le moteur ne la dessine pas) ou FAUX (il la dessine), et ces
// deux comptes-là se lisaient sur `veriteTerrain`, l'orientation géométrique BRUTE, qui ignore que
// le moteur échange la face éliminée sous réflexion. Ce banc compare désormais chaque suppression à
// l'oracle d'orientation vraie — la rasterisation réelle des mêmes cas avec l'état de face du
// moteur (`inverseTransposeOracle.mjs`) — et publie les populations séparées.
//
// LAB_ROOT=… node --experimental-strip-types \
//   packages/sdk-browser/bench/justesse/inverse-transposee-petite-echelle.mjs
import assert from 'node:assert/strict';
import { cameraSelectionUniforms } from '../../gpuSelection.ts';
import { DAG_SELECTION_SHADER } from '../../gpuDagShader.ts';
import {
  INVERSE_TRANSPOSE_AVANT_WGSL,
  INVERSE_TRANSPOSE_WGSL,
} from '../../inverseTransposeWgsl.ts';
import {
  camera,
  VIEWPORT,
  dansLeChamp,
  decisionCpu,
  empaqueteCas,
  veriteTerrain,
} from './inverseTransposeCas.mjs';
import { DETERMINISTES, HORS_BANDE, SCALES, tousLesCas } from './inverseTransposeEchantillon.mjs';
import { classement, dessineParLeMoteur } from './inverseTransposeOracle.mjs';
import { selectionGpu } from './noyauSelectionGpu.mjs';
import { substitueFormeAvant } from './substitutionAvant.mjs';

// --- Le texte d'avant le lot, remis dans le shader livré -----------------------------------------
// Les deux textes viennent d'`inverseTransposeWgsl.ts` : le banc ne réécrit ni le seuil corrigé ni
// celui d'avant, sans quoi il rejouerait sa propre variante du défaut plutôt que le défaut.
const SHADER_AVANT = substitueFormeAvant({
  texte: DAG_SELECTION_SHADER,
  livre: INVERSE_TRANSPOSE_WGSL,
  avant: INVERSE_TRANSPOSE_AVANT_WGSL,
  nom: 'DAG_SELECTION_SHADER (gpuDagShader.ts)',
  origine: 'packages/sdk-browser/inverseTransposeWgsl.ts',
  marqueur: 'abs(det)<1e-20',
});

// --- CPU, vérité brute et oracle du moteur ------------------------------------------------------
const verites = tousLesCas.map(veriteTerrain);
const cpus = tousLesCas.map(decisionCpu);
const champs = tousLesCas.map(dansLeChamp);
const moteur = await dessineParLeMoteur(tousLesCas);

// --- GPU réellement exécuté, un seul lot de dispatch par version --------------------------------
const uniforms = cameraSelectionUniforms(camera, 0, VIEWPORT);
const packed = empaqueteCas(tousLesCas);

/** Les pages rejetées par le noyau WGSL, pour un texte de shader donné. */
async function rejetsGpu(shader) {
  const gpu = await selectionGpu([{ nom: 'lot', packed, uniforms }], shader);
  assert.equal(gpu.indisponible ?? null, null, `GPU indisponible : ${gpu.indisponible}`);
  assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], [], 'WGSL');
  const gardees = new Set(gpu.resultats.find((r) => r.nom === 'lot').pages);
  return { adaptateur: gpu.adaptateur, rejets: tousLesCas.map((_, i) => !gardees.has(i)) };
}

const avant = await rejetsGpu(SHADER_AVANT);
const apres = await rejetsGpu(DAG_SELECTION_SHADER);

// --- Classement : les populations, séparées ------------------------------------------------------
const { index, fausses, population } = classement({ cas: tousLesCas, verites, moteur });
const popAvant = population(avant.rejets);
const popApres = population(apres.rejets);
const changements = index.filter((i) => avant.rejets[i] !== apres.rejets[i]);
const aCetteEchelle = (s, liste) => liste.filter((i) => tousLesCas[i].s === s).length;
const parEchelle = Object.fromEntries(
  SCALES.map((s) => [
    s,
    {
      cas: aCetteEchelle(s, index),
      faussesAvant: aCetteEchelle(s, fausses(avant.rejets)),
      faussesApres: aCetteEchelle(s, fausses(apres.rejets)),
      selectionsChangees: aCetteEchelle(s, changements),
    },
  ]),
);

console.log(
  JSON.stringify(
    {
      adaptateurGpu: apres.adaptateur,
      adaptateurOracle: moteur.adaptateur,
      totalCas: tousLesCas.length,
      dessinesParLeMoteur: moteur.dessine.filter(Boolean).length,
      suppressionsAvant: popAvant,
      suppressionsApres: popApres,
      selectionsChangees: changements.length,
      parEchelle,
      contreExemple: {
        cas: DETERMINISTES[0][1],
        dansLeChamp: champs[0],
        verite: verites[0],
        fragmentsDuMoteur: moteur.fragments[0],
        cpu: cpus[0],
        gpuAvant: avant.rejets[0],
        gpuApres: apres.rejets[0],
      },
      temoins: DETERMINISTES.slice(1).map(([nom], k) => ({
        nom,
        verite: verites[k + 1].avantVisible,
        fragmentsDuMoteur: moteur.fragments[k + 1],
        cpuRejette: cpus[k + 1].coneRejette,
        gpuAvant: avant.rejets[k + 1],
        gpuApres: apres.rejets[k + 1],
      })),
    },
    null,
    2,
  ),
);

// --- Le contre-exemple : le défaut, puis sa disparition ------------------------------------------
const nettementDeFace = (t) => t.face > 0.5 && t.airePixels > 100;
assert.ok(champs[0], 'le contre-exemple doit être dans le champ');
assert.ok(verites[0].triangles.every(nettementDeFace), 'les deux triangles doivent être de face');
assert.ok(moteur.fragments[0] > 0, 'le contre-exemple doit être dessiné par le moteur lui-même');
assert.equal(cpus[0].conforme, true, 'CPU : la transformation doit être jugée conforme');
assert.equal(cpus[0].rejette, false, 'CPU : selectVisiblePages doit garder les 2 triangles');
assert.equal(avant.rejets[0], true, 'avant le lot : le noyau WGSL supprimait le cluster visible');
assert.equal(apres.rejets[0], false, 'après le lot : le noyau WGSL garde le cluster visible');

// --- Les populations, chacune tenue séparément ---------------------------------------------------
assert.ok(
  popAvant.fausses > 0,
  'le défaut doit se voir contre l’oracle du moteur, pas seulement contre la vérité brute',
);
assert.equal(
  popApres.fausses,
  0,
  `après le lot, ${popApres.fausses} cluster(s) que le moteur dessine sont encore supprimés`,
);
assert.equal(
  popApres.brutes,
  popApres.brutesNonDessinees,
  `les ${popApres.brutes} suppressions restantes doivent toutes être des faces que le moteur ne ` +
    'dessine pas ; la vérité brute seule ne peut pas en juger',
);
// L'ancien compte se partage exactement, et il lui manquait une part entière : les deux invariants
// du classement, tenus des deux côtés, disent en chiffres que « 560 » et « 54 » ne mesuraient pas
// ce qu'ils annonçaient.
for (const [nom, pop] of [
  ['avant', popAvant],
  ['après', popApres],
]) {
  assert.equal(
    pop.brutes,
    pop.brutesDessinees + pop.brutesNonDessinees,
    `${nom} : le compte de la vérité brute ne se partage pas`,
  );
  assert.equal(
    pop.fausses,
    pop.brutesDessinees + pop.manqueesParLaVeriteBrute,
    `${nom} : le compte des vraies suppressions ne se partage pas`,
  );
}
assert.ok(
  popAvant.brutesNonDessinees > 0 && popAvant.manqueesParLaVeriteBrute > 0,
  'le compte d’avant se trompait dans les deux sens : s’il cesse de le faire, le dire ici',
);

// --- Ce que le lot ne doit pas changer -----------------------------------------------------------
assert.deepEqual(
  changements.filter((i) => HORS_BANDE.includes(tousLesCas[i].s)),
  [],
  'hors de la bande du seuil (det ≥ 1e-20), aucune sélection ne doit changer',
);
assert.equal(apres.rejets[1], false, 'témoin grande échelle : det ≫ 1e-20, le GPU garde');
assert.equal(verites[2].avantVisible, false, 'témoin sans rotation : les faces sont bien de dos');
assert.equal(moteur.fragments[2], 0, 'témoin sans rotation : le moteur n’en dessine rien');
assert.equal(apres.rejets[2], true, 'témoin sans rotation : le rejet légitime doit être conservé');
assert.equal(
  apres.rejets[3],
  false,
  'témoin non conforme : jamais rejeté, quelle que soit la rotation',
);

console.error(
  `Verdict : défaut 6 RÉEL — mesuré contre ce que le moteur DESSINE, ${popAvant.fausses} clusters ` +
    `sur ${tousLesCas.length} étaient supprimés avant le lot, ${popApres.fausses} après. ` +
    `Le compte d'autrefois, « ${popAvant.brutes} avant, ${popApres.brutes} après », lisait la ` +
    `vérité BRUTE : avant le lot il comptait ${popAvant.brutesNonDessinees} suppressions ` +
    `légitimes comme des défauts et en manquait ${popAvant.manqueesParLaVeriteBrute} qui en ` +
    `étaient. 0 sélection changée hors bande, ${moteur.dessine.filter(Boolean).length} clusters ` +
    `dessinés sur ${tousLesCas.length}. Noyau ${apres.adaptateur}, oracle ${moteur.adaptateur}.`,
);
