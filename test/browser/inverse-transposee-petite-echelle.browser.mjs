// Defect 6 (`inverseTranspose3` threshold, gpuDagShader.ts): the WGSL kernel actually run in
// Chromium WebGPU must keep a cluster whose two triangles face the camera after a 180° rotation,
// at every uniform scale — including under s ≈ 2.15e-7, where the absolute threshold
// `abs(det)<1e-20` on the raw determinant left the local axis unrotated and dropped the page.
// Legitimate rejection (same triangles, backs to the camera) must remain, at those same scales.
// The full campaign, its figures and the pre-batch version live in
// `test/justesse/inverse-transposee-petite-echelle.mjs`.
//
// node --experimental-strip-types test/browser/inverse-transposee-petite-echelle.browser.mjs
import assert from 'node:assert/strict';
import { cameraSelectionUniforms } from '../../packages/sdk-browser/gpuSelection.ts';
import {
  vue,
  VIEWPORT,
  construireCas,
  decisionCpu,
  empaqueteCas,
  veriteTerrain,
} from '../justesse/inverseTransposeCas.mjs';
import { selectionGpu } from '../justesse/noyauSelectionGpu.mjs';

/** 180° rotation: faces look at the camera. Without rotation: they turn their backs on it. */
const ECHELLES = [1e-3, 1e-6, 2e-7, 1e-7, 1e-8, 1e-12, 1e-16];
const cas = ECHELLES.flatMap((s) =>
  [180, 0].map((angleDeg) => ({
    nom: `s=${s} rotation=${angleDeg}`,
    ...construireCas({ s, kind: 'uniforme', worldSize: 2, axis: [1, 0, 0], angleDeg }),
  })),
);

const uniforms = cameraSelectionUniforms(vue, 0, VIEWPORT);
const packed = empaqueteCas(cas);
const gpu = await selectionGpu([{ nom: 'lot', packed, uniforms }]);
const indisponible = gpu.indisponible ?? null;
const gardees = new Set(gpu.resultats?.find((r) => r.nom === 'lot')?.pages ?? []);
const lignes = cas.map((c, i) => ({
  nom: c.nom,
  faceVisible: veriteTerrain(c).avantVisible,
  cpuRejette: decisionCpu(c).coneRejette,
  gpuRejette: !gardees.has(i),
}));
console.log(
  JSON.stringify(
    {
      adaptateur: gpu.adaptateur ?? null,
      compilation: gpu.compilation ?? [],
      erreurs: gpu.erreurs ?? [],
      indisponible,
      lignes,
    },
    null,
    2,
  ),
);

assert.equal(indisponible, null, String(indisponible));
assert.deepEqual(gpu.compilation ?? [], []);
assert.deepEqual(gpu.erreurs ?? [], []);

for (const ligne of lignes) {
  assert.equal(
    ligne.gpuRejette,
    ligne.cpuRejette,
    `${ligne.nom}: the WGSL kernel must decide like the CPU cut`,
  );
  if (ligne.faceVisible)
    assert.equal(ligne.gpuRejette, false, `${ligne.nom}: visible face dropped by the WGSL kernel`);
  else
    assert.equal(ligne.gpuRejette, true, `${ligne.nom}: legitimate reject lost by the WGSL kernel`);
}
assert.equal(lignes.filter((l) => l.faceVisible).length, ECHELLES.length, 'half the cases face-on');

console.log(
  `OK: ${lignes.length} cases, one run of the WGSL kernel — see` +
    ' test/browser/inverse-transposee-petite-echelle.browser.mjs',
);
