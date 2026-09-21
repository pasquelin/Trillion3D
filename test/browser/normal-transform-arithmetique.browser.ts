// What ties `xformNormal`'s f32 model to the shader actually executed.
//
// `packages/sdk-browser/normalTransform.test.ts` probes lighting-normal transform
// arithmetic on an f32 MODEL (`test/justesse/inverseTransposeF32.ts`), without GPU:
// it catches a regression in `pnpm test`, but a model is a second implementation,
// free to drift from the shipped text unseen. This file closes the loop: the engine's
// `NORMAL_TRANSFORM_WGSL` text is compiled and run in Chromium WebGPU on EXACTLY the
// same cases (`test/justesse/normalTransformCas.ts`), and its output must match the
// model. A shader that does not compile fails this test, and a drifting model too.
//
// node --experimental-strip-types test/browser/normal-transform-arithmetique.browser.ts
import assert from 'node:assert/strict';
import { angleEntre, verdictNormale, xformNormalModele } from '../justesse/inverseTransposeF32.ts';
import {
  CAS,
  DECROCHE_DEG,
  DEG,
  GARDES,
  REGULIERE_MINUSCULE,
} from '../justesse/normalTransformCas.ts';
import { eclairageGpu } from '../justesse/normaleEclairageGpu.ts';

const TOUS = [...CAS, ...GARDES, REGULIERE_MINUSCULE];
const gpu = await eclairageGpu(TOUS);

// Compilation first: no `assert.match` on source text could hold this.
assert.equal(gpu.indisponible ?? null, null, String(gpu.indisponible));
assert.deepEqual(gpu.compilation ?? [], [], 'the lighting shader does not compile');
assert.deepEqual(gpu.erreurs ?? [], [], 'WebGPU errors during execution');

// The criterion: ORIENTED direction, null or non-finite vector refused, unit length checked. A
// `NaN` gap satisfies no comparison, so a lost normal fails instead of passing.
const lignes = TOUS.map((cas, i) => {
  const rendueGpu = gpu.lignes[i].rendue;
  const rendueModele = xformNormalModele(cas.world, cas.normale);
  const auVrai = verdictNormale(rendueGpu, cas.vraie, DECROCHE_DEG);
  return {
    nom: cas.nom,
    effondree: cas.effondree ?? false,
    degenere: cas.degenere ?? false,
    ecartAuModeleDeg: angleEntre(rendueGpu, rendueModele) * DEG,
    ecartAuVraiDeg: auVrai.ecartDeg,
    normeGpu: auVrai.norme,
    auVrai,
    rendueGpu,
    rendueModele,
  };
});
/** Lines that HAVE a direction: a collapsed face returns the null vector, whose angle is NaN. */
const orientees = lignes.filter((l) => !l.effondree);
const pire = (cle: 'ecartAuModeleDeg' | 'ecartAuVraiDeg') =>
  orientees.reduce((x, l) => Math.max(x, l[cle]), 0);
console.log(
  JSON.stringify(
    {
      adaptateur: gpu.adaptateur ?? null,
      cas: lignes.length,
      ordinaires: CAS.length,
      gardes: GARDES.length + 1,
      pireEcartAuModeleDeg: pire('ecartAuModeleDeg'),
      pireEcartAuVraiDeg: pire('ecartAuVraiDeg'),
      gardesRendus: lignes
        .filter((l) => l.degenere)
        .map((l) => ({ nom: l.nom, gpu: l.rendueGpu, attendu: l.auVrai.ecartDeg })),
    },
    null,
    2,
  ),
);

// 1. The shipped shader renders what the model renders. The tolerance covers the only expected
//    gap: GPU `normalize` and the model's do not round to the same f32 ULP.
for (const ligne of orientees)
  assert.ok(
    ligne.ecartAuModeleDeg < 1e-3,
    `${ligne.nom}: shader renders ${ligne.rendueGpu}, model ${ligne.rendueModele} — ` +
      `${ligne.ecartAuModeleDeg}° gap, the model has drifted from the shipped text`,
  );

// 2. And it renders the right normal: that of the rotated surface, on the right SIDE, unit length,
//    at any scale — including when the pose FLATTENS the primitive onto a plane, where the expected
//    normal is that of the transformed face, computed by hand in `normalTransformCas.ts`. The
//    verdict carries the three requirements; its `raison` says which one failed.
for (const ligne of orientees)
  assert.ok(ligne.auVrai.ok, `${ligne.nom}: ${ligne.auVrai.raison} — rendered ${ligne.rendueGpu}`);

// 3. Poses that COLLAPSE the face, on the real GPU: null 3×3, rank 1, infinite or NaN sum.
//    A face with no world area has no normal: the shader returns the null vector, exactly, and
//    never a NaN — which screen derivatives would spread onto neighbouring pixels — nor the local
//    normal of a surface that no longer exists. The guard's bitcast is WGSL: no JS model proves
//    it does that.
for (const ligne of lignes.filter((l) => l.effondree))
  assert.deepEqual(
    ligne.rendueGpu,
    [0, 0, 0],
    `${ligne.nom}: GPU renders ${ligne.rendueGpu}, expected the null vector`,
  );

console.log(
  `OK: ${lignes.length} cases, engine lighting text compiled and run — worst gap to ` +
    `the model ${pire('ecartAuModeleDeg')}°, to the true normal ${pire('ecartAuVraiDeg')}°. ` +
    `Adapter ${gpu.adaptateur}.`,
);
