// Defect 10, proof on a real GPU: under a negative-determinant transform, the visibility-buffer
// CPU rasteriser (`rasterVisibility`) and the engine's WebGPU rasterisation — `cullMode:'back'`
// and the `frontFace` that `windingCw` flips — must draw the same clusters, and cone rejection
// must drop none of them.
//
// The sample is that of defect 6: 6 916 cases, of which 3 456 reflections, from scale 1e-3 to
// 1e-16. Before this batch, the CPU drew under reflection the face every other path culls:
// 2 421 disagreements, all reflections, and the 54 cases where the cone "dropped a visible
// face" were only visible to that rasteriser.
//
// node --experimental-strip-types test/browser/reflexion-face-eliminee.browser.mjs
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

assert.ok(reflexions.length > 3000, 'the sample must contain thousands of reflections');
assert.deepEqual(
  desaccords,
  [],
  'CPU and GPU must cull the same face, reflection included (defect 10)',
);
assert.deepEqual(
  supprimesVisibles,
  [],
  'cone rejection must drop no cluster that either path draws',
);
assert.ok(
  index.some((i) => tousLesCas[i].miroir && dessineGpu[i]),
  'witness: some reflections must actually be drawn, or equality would be empty of meaning',
);
assert.ok(
  index.some((i) => coneRejette[i]),
  'witness: the cone must still reject clusters, or equality would be empty of meaning',
);

console.log(
  'OK: 6 916 cases rasterised on a real GPU — see test/browser/reflexion-face-eliminee.browser.mjs',
);
