// Ce fichier éprouve le CRITÈRE de la preuve (`verdictNormale`), pas seulement le nuanceur livré.
// `SUBSTITUTIONS` (`normaleEclairageGpu.mjs`) altère la sortie de `xformNormal` à l'endroit exact où
// l'éclairage la lit, sur le vrai texte compilé et exécuté dans Chromium WebGPU : `opposee` rend la
// normale retournée (N→−N, le défaut le plus courant d'une inverse-transposée), `nulle` rend la
// normale perdue (N→0). Si `verdictNormale` laissait passer l'une des deux, il ne protégerait rien
// dans `test/normalTransformArithmetique.browser.mjs` — c'est exactement ce que l'ANCIEN critère
// faisait : une valeur absolue sur le produit scalaire confondait N et −N, et `atan2(0, 0) = 0`
// déclarait juste une normale perdue. `aucune` (le nuanceur intact) sert de témoin dans ce même
// fichier : sans lui, un critère devenu trop strict passerait aussi inaperçu.
//
// LAB_ROOT=… node --experimental-strip-types test/normaleEclairageSubstitutionsRefusees.browser.mjs
import assert from 'node:assert/strict';
import { verdictNormale } from '../packages/sdk-browser/bench/justesse/inverseTransposeF32.mjs';
import { CAS, DECROCHE_DEG } from '../packages/sdk-browser/bench/justesse/normalTransformCas.mjs';
import {
  SUBSTITUTIONS,
  eclairageGpu,
} from '../packages/sdk-browser/bench/justesse/normaleEclairageGpu.mjs';

async function verdicts(substitution) {
  const gpu = await eclairageGpu(CAS, { substitution });
  assert.equal(gpu.indisponible ?? null, null, String(gpu.indisponible));
  assert.deepEqual(gpu.compilation ?? [], [], `substitution « ${substitution} » : compilation`);
  assert.deepEqual(gpu.erreurs ?? [], [], `substitution « ${substitution} » : erreurs GPU`);
  return CAS.map((cas, i) => ({
    nom: cas.nom,
    verdict: verdictNormale(gpu.lignes[i].rendue, cas.vraie, DECROCHE_DEG),
  }));
}

const opposee = await verdicts(SUBSTITUTIONS.opposee);
const nulle = await verdicts(SUBSTITUTIONS.nulle);
const intacte = await verdicts(SUBSTITUTIONS.aucune);

console.log(
  JSON.stringify(
    {
      cas: CAS.length,
      opposeeRefus: opposee.filter((l) => !l.verdict.ok).length,
      nulleRefus: nulle.filter((l) => !l.verdict.ok).length,
      intacteRefus: intacte.filter((l) => !l.verdict.ok).length,
    },
    null,
    2,
  ),
);

// N→−N : la normale retournée. Le critère orienté doit refuser CHAQUE cas, à ~180° de la vraie.
for (const { nom, verdict } of opposee) {
  assert.ok(!verdict.ok, `${nom} : N→−N passe le critère, il ne distingue plus N de −N`);
  assert.ok(
    Math.abs(verdict.ecartDeg - 180) < 1e-2,
    `${nom} : N→−N à ${verdict.ecartDeg}°, attendu ≈ 180°`,
  );
}

// N→0 : la normale perdue. `direction` la refuse avant tout angle — jamais un NaN qui passerait,
// jamais un atan2(0,0) = 0 qui la déclarerait juste comme l'ancien critère.
for (const { nom, verdict } of nulle) {
  assert.ok(!verdict.ok, `${nom} : N→0 passe le critère, une normale perdue n'est plus détectée`);
  assert.ok(
    Number.isNaN(verdict.ecartDeg),
    `${nom} : N→0 donne un écart de ${verdict.ecartDeg}°, attendu NaN (sans direction)`,
  );
  assert.match(
    verdict.raison ?? '',
    /sans direction/,
    `${nom} : raison inattendue « ${verdict.raison} »`,
  );
}

// Le témoin : le nuanceur intact, sur les mêmes cas, reste vert — sinon le critère est trop strict.
for (const { nom, verdict } of intacte)
  assert.ok(verdict.ok, `${nom} : nuanceur intact refusé — ${verdict.raison}`);

console.log(
  `OK : ${CAS.length} cas — N→−N refusés ${opposee.length}/${opposee.length}, N→0 refusés ` +
    `${nulle.length}/${nulle.length}, intact accepté ${intacte.length}/${intacte.length}.`,
);
