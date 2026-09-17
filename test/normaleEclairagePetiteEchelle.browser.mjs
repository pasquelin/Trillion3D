// Défaut 9 (`NORMAL_TRANSFORM_WGSL`, standardLighting.ts) : les textes WGSL d'éclairage du moteur,
// réellement exécutés dans Chromium WebGPU, doivent rendre une normale qui a suivi la rotation à
// toute échelle uniforme — y compris sous s ≈ 2,15e-7, où le seuil absolu `abs(det)<1e-20` sur le
// déterminant brut rendait la normale locale et éclairait la surface comme si elle n'avait pas
// tourné. La vérité terrain est l'inverse-transposée f64 de Three. La campagne complète, ses
// chiffres et sa version d'avant le lot sont dans
// `test/justesse/normale-eclairage-petite-echelle.mjs`.
//
// LAB_ROOT=… node --experimental-strip-types test/normaleEclairagePetiteEchelle.browser.mjs
import assert from 'node:assert/strict';
import {
  construireCas,
  ecart,
} from './justesse/normaleEclairageCas.mjs';
import { eclairageGpu } from './justesse/normaleEclairageGpu.mjs';

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
    `${ligne.nom} : la normale d'éclairage a décroché de ${ligne.angleDeg}°`,
  );
  assert.ok(
    ligne.ecartLuminance < 1e-4,
    `${ligne.nom} : luminance ${ligne.luminanceRendue} au lieu de ${ligne.luminanceVraie}`,
  );
}
// Une rotation de 90° autour de Y envoie la normale locale (0,0,1) sur (1,0,0) : sans elle, le cas
// ne prouverait rien. La vérité terrain f64 doit donc bien être tournée.
for (const c of cas) assert.ok(Math.abs(c.vraie[0]) > 0.99, `${c.nom} : cas non discriminant`);

console.log(
  `OK : ${lignes.length} cas, une exécution des textes d'éclairage — voir` +
    ' test/normaleEclairagePetiteEchelle.browser.mjs',
);
