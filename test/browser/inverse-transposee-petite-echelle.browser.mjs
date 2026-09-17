// Défaut 6 (seuil de `inverseTranspose3`, gpuDagShader.ts) : le noyau WGSL réellement exécuté dans
// Chromium WebGPU doit garder un cluster dont les deux triangles sont de face après une rotation de
// 180°, à toute échelle uniforme — y compris sous s ≈ 2,15e-7, où le seuil absolu `abs(det)<1e-20`
// sur le déterminant brut rendait l'axe local non tourné et supprimait la page. Le rejet légitime
// (mêmes triangles, dos à la caméra) doit rester, à ces mêmes échelles. La campagne complète, ses
// chiffres et sa version d'avant le lot sont dans
// `test/justesse/inverse-transposee-petite-echelle.mjs`.
//
// LAB_ROOT=… node --experimental-strip-types test/browser/inverseTransposeePetiteEchelle.browser.mjs
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

/** Rotation de 180° : les faces regardent la caméra. Sans rotation : elles lui tournent le dos. */
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
    `${ligne.nom} : le noyau WGSL doit décider comme la coupe CPU`,
  );
  if (ligne.faceVisible)
    assert.equal(
      ligne.gpuRejette,
      false,
      `${ligne.nom} : face visible supprimée par le noyau WGSL`,
    );
  else
    assert.equal(ligne.gpuRejette, true, `${ligne.nom} : rejet légitime perdu par le noyau WGSL`);
}
assert.equal(lignes.filter((l) => l.faceVisible).length, ECHELLES.length, 'moitié des cas de face');

console.log(
  `OK : ${lignes.length} cas, une exécution du noyau WGSL — voir` +
    ' test/browser/inverseTransposeePetiteEchelle.browser.mjs',
);
