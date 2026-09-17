// Défaut 10, preuve sur carte graphique réelle : sous une transformation de déterminant négatif, le
// rasteriseur CPU du tampon de visibilité (`rasterVisibility`) et la rasterisation WebGPU du moteur
// — `cullMode:'back'` et le `frontFace` que `windingCw` inverse — doivent dessiner les mêmes
// clusters, et le rejet par cône ne doit en supprimer aucun.
//
// L'échantillon est celui du défaut 6 : 6 916 cas, dont 3 456 réflexions, de l'échelle 1e-3 à
// 1e-16. Avant ce lot, le CPU dessinait sous réflexion la face que tous les autres chemins
// éliminent : 2 421 désaccords, tous des réflexions, et les 54 cas où le cône « supprimait une face
// visible » n'étaient visibles que de ce rasteriseur-là.
//
// LAB_ROOT=… node --experimental-strip-types test/browser/reflexionFaceEliminee.browser.mjs
import assert from 'node:assert/strict';
import { rasterVisibility } from '../../packages/sdk-browser/visibilityRaster.ts';
import { decisionCpu, vue } from '../justesse/inverseTransposeCas.mjs';
import { tousLesCas } from '../justesse/inverseTransposeEchantillon.mjs';
import { chargeRaster, pageVisible, VUE } from '../justesse/reflexionCas.mjs';
import { rasterGpu } from '../justesse/noyauRasterGpu.mjs';

const gpu = await rasterGpu(chargeRaster(tousLesCas));
assert.equal(gpu.indisponible ?? null, null, String(gpu.indisponible));
assert.deepEqual(gpu.compilation ?? [], []);
assert.deepEqual(gpu.erreurs ?? [], []);

const index = tousLesCas.map((_, i) => i);
const dessineGpu = index.map((i) => gpu.fragments[i] > 0);
const dessineCpu = index.map((i) => {
  const { ids } = rasterVisibility([pageVisible(tousLesCas[i])], vue, VUE);
  return ids.some((identifiant) => identifiant !== 0);
});
const coneRejette = tousLesCas.map((cas) => decisionCpu(cas).coneRejette);

const reflexions = index.filter((i) => tousLesCas[i].miroir);
const desaccords = index.filter((i) => dessineCpu[i] !== dessineGpu[i]);
const supprimesVisibles = index.filter((i) => coneRejette[i] && (dessineCpu[i] || dessineGpu[i]));
console.log(
  JSON.stringify(
    {
      adaptateur: gpu.adaptateur,
      totalCas: index.length,
      reflexions: reflexions.length,
      dessineParLeGpu: dessineGpu.filter(Boolean).length,
      dessineParLeCpu: dessineCpu.filter(Boolean).length,
      desaccordsCpuGpu: desaccords.length,
      faceVisibleSupprimeeParLeCone: supprimesVisibles.length,
    },
    null,
    2,
  ),
);

assert.ok(reflexions.length > 3000, 'l’échantillon doit contenir des milliers de réflexions');
assert.deepEqual(
  desaccords,
  [],
  'CPU et GPU doivent éliminer la même face, réflexion comprise (défaut 10)',
);
assert.deepEqual(
  supprimesVisibles,
  [],
  'le rejet par cône ne doit supprimer aucun cluster qu’un des deux chemins dessine',
);
assert.ok(
  index.some((i) => tousLesCas[i].miroir && dessineGpu[i]),
  'témoin : des réflexions doivent bien être dessinées, sans quoi l’égalité serait vide de sens',
);
assert.ok(
  index.some((i) => coneRejette[i]),
  'témoin : le cône doit encore rejeter des clusters, sans quoi l’égalité serait vide de sens',
);

console.log(
  'OK : 6 916 cas rasterisés sur carte graphique réelle — voir test/browser/reflexionFaceEliminee.browser.mjs',
);
