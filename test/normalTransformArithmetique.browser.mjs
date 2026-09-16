// Ce qui rattache le modèle f32 de `xformNormal` au nuanceur réellement exécuté.
//
// `packages/sdk-browser/normalTransform.test.ts` éprouve l'arithmétique de la transformation des
// normales d'éclairage sur un MODÈLE f32 (`bench/justesse/inverseTransposeF32.mjs`), sans GPU : il
// attrape une régression dans `npm test`, mais un modèle est une seconde implémentation, libre de
// dériver du texte livré sans que personne le voie. Ce fichier-ci ferme la boucle : le texte
// `NORMAL_TRANSFORM_WGSL` du moteur est compilé et exécuté dans Chromium WebGPU sur EXACTEMENT les
// mêmes cas (`bench/justesse/normalTransformCas.mjs`), et sa sortie doit être celle du modèle. Un
// nuanceur qui ne compile pas fait échouer ce test, et un modèle qui dérive aussi.
//
// LAB_ROOT=… node --experimental-strip-types test/normalTransformArithmetique.browser.mjs
import assert from 'node:assert/strict';
import {
  angleEntre,
  unitaire,
  verdictNormale,
  xformNormalModele,
} from '../packages/sdk-browser/bench/justesse/inverseTransposeF32.mjs';
import {
  CAS,
  DECROCHE_DEG,
  DEG,
  GARDES,
  REGULIERE_MINUSCULE,
} from '../packages/sdk-browser/bench/justesse/normalTransformCas.mjs';
import { eclairageGpu } from '../packages/sdk-browser/bench/justesse/normaleEclairageGpu.mjs';

const TOUS = [...CAS, ...GARDES, REGULIERE_MINUSCULE];
const gpu = await eclairageGpu(TOUS);

// La compilation d'abord : c'est elle qu'aucun `assert.match` sur du texte ne pouvait tenir.
assert.equal(gpu.indisponible ?? null, null, String(gpu.indisponible));
assert.deepEqual(gpu.compilation ?? [], [], 'le nuanceur d’éclairage ne compile pas');
assert.deepEqual(gpu.erreurs ?? [], [], 'erreurs WebGPU pendant l’exécution');

// Le critère : direction ORIENTÉE, vecteur nul ou non fini refusé, norme vérifiée unitaire. Un
// écart `NaN` ne satisfait aucune comparaison, donc une normale perdue tombe au lieu de passer.
const lignes = TOUS.map((cas, i) => {
  const rendueGpu = gpu.lignes[i].rendue;
  const rendueModele = xformNormalModele(cas.world, cas.normale);
  const auVrai = verdictNormale(rendueGpu, cas.vraie, DECROCHE_DEG);
  return {
    nom: cas.nom,
    degenere: cas.degenere ?? false,
    ecartAuModeleDeg: angleEntre(rendueGpu, rendueModele) * DEG,
    ecartAuVraiDeg: auVrai.ecartDeg,
    normeGpu: auVrai.norme,
    auVrai,
    rendueGpu,
    rendueModele,
  };
});
const pire = (cle) => lignes.reduce((x, l) => Math.max(x, l[cle]), 0);
console.log(
  JSON.stringify(
    {
      adaptateur: gpu.adaptateur ?? null,
      cas: lignes.length,
      ordinaires: CAS.length,
      gardes: GARDES.length + 1,
      pireEcartAuModeleDeg: pire('ecartAuModeleDeg'),
      pireEcartAuVraiDeg: pire('ecartAuVraiDeg'),
      gardesRendus: lignes.filter((l) => l.degenere).map((l) => ({ nom: l.nom, gpu: l.rendueGpu })),
    },
    null,
    2,
  ),
);

// 1. Le nuanceur livré rend ce que le modèle rend. La tolérance couvre le seul écart attendu : le
//    `normalize` du GPU et celui du modèle n'arrondissent pas au même ULP f32.
for (const ligne of lignes)
  assert.ok(
    ligne.ecartAuModeleDeg < 1e-3,
    `${ligne.nom} : le shader rend ${ligne.rendueGpu}, le modèle ${ligne.rendueModele} — ` +
      `${ligne.ecartAuModeleDeg}° d'écart, le modèle a dérivé du texte livré`,
  );

// 2. Et il rend la bonne normale : celle de la surface tournée, du bon CÔTÉ, unitaire, à toute
//    échelle. Le verdict porte les trois exigences ; son `raison` dit laquelle a manqué.
for (const ligne of lignes.filter((l) => !l.degenere))
  assert.ok(ligne.auVrai.ok, `${ligne.nom} : ${ligne.auVrai.raison} — rendue ${ligne.rendueGpu}`);

// 3. Les gardes, sur le vrai GPU : une 3×3 nulle, à colonne nulle, infinie ou NaN rend le vecteur
//    tel quel — donc, après `normalize`, la normale locale unitaire, et jamais un NaN dans
//    l'éclairage. Le bitcast du garde est du WGSL : aucun modèle JS ne prouve qu'il fait cela.
for (const ligne of lignes.filter((l) => l.degenere)) {
  const attendu = unitaire(TOUS.find((cas) => cas.nom === ligne.nom).normale);
  const verdict = verdictNormale(ligne.rendueGpu, attendu, DECROCHE_DEG);
  assert.ok(verdict.ok, `${ligne.nom} : ${verdict.raison} — le GPU rend ${ligne.rendueGpu}`);
}

console.log(
  `OK : ${lignes.length} cas, le texte d'éclairage du moteur compilé et exécuté — pire écart au ` +
    `modèle ${pire('ecartAuModeleDeg')}°, à la normale vraie ${pire('ecartAuVraiDeg')}°. ` +
    `Adaptateur ${gpu.adaptateur}.`,
);
