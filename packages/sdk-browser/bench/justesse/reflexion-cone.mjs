// Défaut 10 : « sous une réflexion, le rejet par cône supprime des faces visibles, en CPU comme en
// GPU ». Ce script tranche la thèse laissée par le lot du défaut 6 en opposant trois lectures des
// mêmes 6 916 cas, toutes mesurées, aucune supposée :
//
//   1. l'orientation géométrique BRUTE des sommets transformés (`veriteTerrain`, celle du lot 6) ;
//   2. ce que le GPU dessine vraiment — rasterisation réelle avec l'état de face du moteur, dont le
//      `frontFace` que `windingCw` inverse sous réflexion, comme Three en WebGL ;
//   3. ce que le rasteriseur CPU du tampon de visibilité dessine (`rasterVisibility`).
//
// Verdict : la thèse du lot 6 est FAUSSE. Le cône ne supprime aucun cluster que le GPU dessine
// (0 sur 6 916, dont 3 456 réflexions) ; ses 54 « suppressions » sont des cas que la vérité brute
// dit visibles et que le moteur ne dessine pas, parce qu'il échange la face éliminée sous réflexion.
// Multiplier l'axe du cône par `sign(det)` ne corrigerait rien : cela casserait l'accord.
// Le vrai défaut est ailleurs et il est bien en CPU : `visibilityRaster` était le seul chemin à ne
// pas échanger la face éliminée, et il dessinait donc exactement les faces que le cône supprime.
//
// LAB_ROOT=… node --experimental-strip-types \
//   packages/sdk-browser/bench/justesse/reflexion-cone.mjs
import assert from 'node:assert/strict';
import { rasterVisibility } from '../../visibilityRaster.ts';
import { camera, decisionCpu, veriteTerrain } from './inverseTransposeCas.mjs';
import { tousLesCas } from './inverseTransposeEchantillon.mjs';
import { chargeRaster, pageVisible, sensDuMoteur, VUE } from './reflexionCas.mjs';
import { rasterGpu } from './noyauRasterGpu.mjs';

// --- Ce que le GPU dessine réellement -----------------------------------------------------------
const gpu = await rasterGpu(chargeRaster(tousLesCas));
assert.equal(gpu.indisponible ?? null, null, `GPU indisponible : ${gpu.indisponible}`);
assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], [], 'WGSL');

// --- Ce que le CPU dessine, et ce que le cône décide --------------------------------------------
const pixelsCpu = tousLesCas.map((cas) => {
  const { ids } = rasterVisibility([pageVisible(cas)], camera, VUE);
  let n = 0;
  for (const identifiant of ids) if (identifiant !== 0) n++;
  return n;
});
const verites = tousLesCas.map(veriteTerrain);
const cpus = tousLesCas.map(decisionCpu);

const index = tousLesCas.map((_, i) => i);
const compte = (predicat) => index.filter(predicat).length;
const dessineGpu = (i) => gpu.fragments[i] > 0;
const dessineCpu = (i) => pixelsCpu[i] > 0;
const miroir = (i) => tousLesCas[i].miroir;
const rejette = (i) => cpus[i].coneRejette;

const mesure = {
  adaptateurGpu: gpu.adaptateur,
  totalCas: index.length,
  reflexions: compte(miroir),
  sensInverseParLeMoteur: compte((i) => sensDuMoteur(tousLesCas[i]) === 'cw'),
  dessineParLeGpu: compte(dessineGpu),
  dessineParLeCpu: compte(dessineCpu),
  desaccordCpuGpu: compte((i) => dessineCpu(i) !== dessineGpu(i)),
  desaccordSansReflexion: compte((i) => dessineCpu(i) !== dessineGpu(i) && !miroir(i)),
  // La thèse du lot 6, mesurée : le cône supprime-t-il ce que le moteur dessine ?
  coneSupprimeUnDessinGpu: compte((i) => rejette(i) && dessineGpu(i)),
  coneSupprimeUnDessinCpu: compte((i) => rejette(i) && dessineCpu(i)),
  // Ce que le lot 6 comptait : le cône contre la vérité BRUTE, qui ignore l'échange de face.
  coneContreVeriteBrute: compte((i) => rejette(i) && verites[i].avantVisible),
  veriteBruteDitVisibleEtRienDeDessine: compte((i) => verites[i].avantVisible && !dessineGpu(i)),
  dontDesReflexions: compte((i) => verites[i].avantVisible && !dessineGpu(i) && miroir(i)),
  veriteBruteDitInvisibleEtDessine: compte((i) => !verites[i].avantVisible && dessineGpu(i)),
};
console.log(JSON.stringify(mesure, null, 2));

// --- La thèse du lot 6 est réfutée --------------------------------------------------------------
assert.ok(mesure.reflexions > 3000, 'l’échantillon doit contenir des milliers de réflexions');
assert.equal(
  mesure.coneSupprimeUnDessinGpu,
  0,
  'le rejet par cône ne supprime aucun cluster que le GPU dessine : la thèse du défaut 10 est fausse',
);
assert.ok(
  mesure.coneContreVeriteBrute > 0,
  'la vérité BRUTE, elle, accuse encore le cône — c’est elle qui ignore l’échange de face',
);
assert.equal(
  mesure.veriteBruteDitVisibleEtRienDeDessine,
  mesure.dontDesReflexions,
  'tout écart entre la vérité brute et le dessin réel est une réflexion',
);
assert.ok(
  mesure.veriteBruteDitInvisibleEtDessine > 0,
  'et l’écart joue dans les deux sens : le moteur dessine aussi ce que la vérité brute dit de dos',
);

// --- Le vrai défaut, et sa disparition ----------------------------------------------------------
assert.equal(
  mesure.desaccordSansReflexion,
  0,
  'hors réflexion, CPU et GPU dessinaient déjà pareil',
);
assert.equal(
  mesure.desaccordCpuGpu,
  0,
  'après le lot, le rasteriseur CPU échange la face éliminée sous réflexion comme le GPU',
);
assert.equal(
  mesure.coneSupprimeUnDessinCpu,
  0,
  'et il ne dessine donc plus les faces que le rejet par cône supprime',
);
assert.equal(mesure.dessineParLeCpu, mesure.dessineParLeGpu, 'même nombre de clusters dessinés');

console.error(
  `Verdict : défaut 10 NON CONFIRMÉ tel qu'énoncé — 0/${mesure.totalCas} cluster dessiné par le ` +
    `GPU supprimé par le cône, dont ${mesure.reflexions} réflexions. Les ${mesure.coneContreVeriteBrute} ` +
    `« suppressions » du lot 6 sont un défaut de sa vérité terrain. Défaut réel trouvé et corrigé : ` +
    `le rasteriseur CPU du tampon de visibilité n'échangeait pas la face éliminée sous réflexion. ` +
    `Adaptateur ${mesure.adaptateurGpu}.`,
);
