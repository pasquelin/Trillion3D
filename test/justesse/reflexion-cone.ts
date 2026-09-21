// Defect 10: "under a reflection, cone rejection culls visible faces, on CPU as on
// GPU". This script settles the thesis left by the defect-6 batch by opposing three
// readings of the same 6,916 cases, all measured, none assumed:
//
//   1. RAW geometric orientation of the transformed vertices (`veriteTerrain`, that of batch 6);
//   2. what the GPU actually draws — real rasterisation with the engine's face state,
//      including the `frontFace` that `windingCw` flips under reflection, like Three in WebGL;
//   3. what the CPU visibility-buffer rasteriser draws (`rasterVisibility`).
//
// Verdict: batch 6's thesis is FALSE. The cone culls no cluster that the GPU draws
// (0 of 6,916, of which 3,456 are reflections); its 54 "drops" are cases that raw truth
// calls visible and that the engine does not draw, because it swaps the culled face under
// reflection. Multiplying the cone axis by `sign(det)` would fix nothing: it would break
// the match. The real defect is elsewhere and it is on the CPU: `visibilityRaster` was the
// only path that did not swap the culled face, and so it drew exactly the faces the cone
// culls.
//
// node --experimental-strip-types \
//   test/justesse/reflexion-cone.ts
import assert from 'node:assert/strict';
import { rasterVisibility } from '../../packages/sdk-browser/visibilityRaster.ts';
import { camera, decisionCpu, veriteTerrain } from './inverseTransposeCas.ts';
import { tousLesCas } from './inverseTransposeEchantillon.ts';
import { pageVisible, sensDuMoteur, VUE } from './reflexionCas.ts';
import { dessineParLeMoteur } from './inverseTransposeOracle.ts';
import { cameraMoteur } from '../../packages/sdk-browser/cameraFixture.ts';

// --- What the GPU actually draws: the true-orientation oracle, written once ---------------------
const gpu = await dessineParLeMoteur(tousLesCas);

// --- What the CPU draws, and what the cone decides ----------------------------------------------
const pixelsCpu = tousLesCas.map((cas) => {
  const { ids } = rasterVisibility([pageVisible(cas)], cameraMoteur(camera), VUE);
  let n = 0;
  for (const identifiant of ids) if (identifiant !== 0) n++;
  return n;
});
const verites = tousLesCas.map(veriteTerrain);
const cpus = tousLesCas.map(decisionCpu);

const index = tousLesCas.map((_, i) => i);
const compte = (predicat: (i: number) => boolean): number => index.filter(predicat).length;
const dessineGpu = (i: number): boolean => gpu.dessine[i];
const dessineCpu = (i: number): boolean => pixelsCpu[i] > 0;
const miroir = (i: number): boolean => tousLesCas[i].miroir;
const rejette = (i: number): boolean => cpus[i].coneRejette;

const mesure = {
  adaptateurGpu: gpu.adaptateur,
  totalCas: index.length,
  reflexions: compte(miroir),
  sensInverseParLeMoteur: compte((i) => sensDuMoteur(tousLesCas[i]) === 'cw'),
  dessineParLeGpu: compte(dessineGpu),
  dessineParLeCpu: compte(dessineCpu),
  desaccordCpuGpu: compte((i) => dessineCpu(i) !== dessineGpu(i)),
  desaccordSansReflexion: compte((i) => dessineCpu(i) !== dessineGpu(i) && !miroir(i)),
  // Batch 6's thesis, measured: does the cone cull what the engine draws?
  coneSupprimeUnDessinGpu: compte((i) => rejette(i) && dessineGpu(i)),
  coneSupprimeUnDessinCpu: compte((i) => rejette(i) && dessineCpu(i)),
  // What batch 6 counted: the cone against RAW truth, which ignores the face swap.
  coneContreVeriteBrute: compte((i) => rejette(i) && verites[i].avantVisible),
  veriteBruteDitVisibleEtRienDeDessine: compte((i) => verites[i].avantVisible && !dessineGpu(i)),
  dontDesReflexions: compte((i) => verites[i].avantVisible && !dessineGpu(i) && miroir(i)),
  veriteBruteDitInvisibleEtDessine: compte((i) => !verites[i].avantVisible && dessineGpu(i)),
};
console.log(JSON.stringify(mesure, null, 2));

// --- Batch 6's thesis is refuted ----------------------------------------------------------------
assert.ok(mesure.reflexions > 3000, 'the sample must contain thousands of reflections');
assert.equal(
  mesure.coneSupprimeUnDessinGpu,
  0,
  "cone rejection culls no cluster that the GPU draws: defect 10's thesis is false",
);
assert.ok(
  mesure.coneContreVeriteBrute > 0,
  'RAW truth still accuses the cone — it is the one that ignores the face swap',
);
assert.equal(
  mesure.veriteBruteDitVisibleEtRienDeDessine,
  mesure.dontDesReflexions,
  'every gap between raw truth and the actual draw is a reflection',
);
assert.ok(
  mesure.veriteBruteDitInvisibleEtDessine > 0,
  'and the gap plays both ways: the engine also draws what raw truth calls back-facing',
);

// --- The real defect, and its disappearance -----------------------------------------------------
assert.equal(
  mesure.desaccordSansReflexion,
  0,
  'outside reflection, CPU and GPU already drew the same',
);
assert.equal(
  mesure.desaccordCpuGpu,
  0,
  'after the batch, the CPU rasteriser swaps the culled face under reflection as the GPU does',
);
assert.equal(
  mesure.coneSupprimeUnDessinCpu,
  0,
  'and so it no longer draws the faces that cone rejection culls',
);
assert.equal(mesure.dessineParLeCpu, mesure.dessineParLeGpu, 'same number of clusters drawn');

console.error(
  `Verdict: defect 10 NOT CONFIRMED as stated — 0/${mesure.totalCas} cluster drawn by the ` +
    `GPU culled by the cone, of which ${mesure.reflexions} reflections. The ${mesure.coneContreVeriteBrute} ` +
    `"drops" of batch 6 are a defect of its ground truth. Real defect found and fixed: ` +
    `the CPU visibility-buffer rasteriser did not swap the culled face under reflection. ` +
    `Adapter ${mesure.adaptateurGpu}.`,
);
