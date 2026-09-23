// Defect 9 (`NORMAL_TRANSFORM_WGSL`, standardLighting.ts): the engine's lighting WGSL texts,
// actually run in Chromium WebGPU, must yield a normal that followed the rotation at every
// uniform scale — including under s ≈ 2.15e-7, where the absolute threshold `abs(det)<1e-20` on
// the raw determinant left the normal local and lit the surface as if it had not rotated. Ground
// truth is Three's f64 inverse-transpose. The full campaign, its
// figures and its pre-batch version are in
// `tests/browser/probes/lighting-normal-small-scale.ts`.
//
// node --experimental-strip-types tests/browser/renders/lighting-normal-small-scale.browser.ts
import assert from 'node:assert/strict';
import { construireCas, ecart } from '../probes/lightingNormalCases.ts';
import { eclairageGpu } from '../probes/lightingNormalGpu.ts';

const ECHELLES = [1e3, 1, 1e-3, 1e-6, 2.155e-7, 2.154e-7, 1e-7, 1e-8, 1e-12, 1e-16];
const cas = ECHELLES.flatMap((s) =>
  ['uniforme', 'anisotrope'].map((kind) =>
    construireCas({
      s,
      kind,
      axis: [0, 1, 0],
      angleDeg: 90,
      normale: [0, 0, 1],
      lumiere: [0.3, 0.8, 0.5, 3],
      metal: 0.1,
      rugosite: 0.4,
    }),
  ),
);

const gpu = await eclairageGpu(cas);
const lignes = cas.map((c, i) => ecart(c, gpu.lignes[i]));
console.log(
  JSON.stringify(
    {
      adaptateur: gpu.adaptateur ?? null,
      compilation: gpu.compilation ?? [],
      erreurs: gpu.erreurs ?? [],
      indisponible: gpu.indisponible ?? null,
      lignes,
    },
    null,
    2,
  ),
);

assert.equal(gpu.indisponible ?? null, null, String(gpu.indisponible));
assert.deepEqual(gpu.compilation ?? [], []);
assert.deepEqual(gpu.erreurs ?? [], []);

for (const ligne of lignes) {
  assert.ok(
    ligne.angleDeg < 1e-3,
    `${ligne.nom}: the lighting normal drifted by ${ligne.angleDeg}°`,
  );
  assert.ok(
    ligne.ecartLuminance < 1e-4,
    `${ligne.nom}: luminance ${ligne.luminanceRendue} instead of ${ligne.luminanceVraie}`,
  );
}
// A 90° rotation around Y sends the local normal (0,0,1) onto (1,0,0): without it, the case
// would prove nothing. The f64 ground truth must therefore actually be rotated.
for (const c of cas) assert.ok(Math.abs(c.vraie[0]) > 0.99, `${c.nom}: non-discriminating case`);

console.log(
  `OK: ${lignes.length} cases, one run of the lighting texts — see` +
    ' tests/browser/renders/lighting-normal-small-scale.browser.ts',
);
