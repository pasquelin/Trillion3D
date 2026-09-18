// Ce fichier éprouve le CRITÈRE de la preuve (`verdictNormale`), pas seulement le nuanceur livré.
// `SUBSTITUTIONS` (`normaleEclairageGpu.mjs`) altère la sortie de `xformNormal` à l'endroit exact où
// l'éclairage la lit, sur le vrai texte compilé et exécuté dans Chromium WebGPU : `opposee` rend la
// normale retournée (N→−N, le défaut le plus courant d'une inverse-transposée), `nulle` rend la
// normale perdue (N→0). Si `verdictNormale` laissait passer l'une des deux, il ne protégerait rien
// dans `test/browser/normal-transform-arithmetique.browser.mjs` — c'est exactement ce que l'ANCIEN critère
// faisait : une valeur absolue sur le produit scalaire confondait N et −N, et `atan2(0, 0) = 0`
// déclarait juste une normale perdue. `aucune` (le nuanceur intact) sert de témoin dans ce même
// fichier : sans lui, un critère devenu trop strict passerait aussi inaperçu.
//
// Les cas ordinaires (`CAS`) ne suffisent pas à couvrir le noyau : `APLATIES` éprouve les poses
// singulières qui laissent à la face une aire monde, où le noyau doit rendre la normale de la FACE
// transformée, et `REGULIERE_MINUSCULE` éprouve le témoin de non-gourmandise du garde — une
// rotation minuscule mais régulière, que le garde ne doit pas confisquer. La substitution enveloppe
// la sortie ENTIÈRE de la fonction, cas singuliers compris : les mêmes deux mutations doivent donc
// y être refusées aussi sûrement que sur les cas ordinaires.
//
// `EFFONDREES` reste HORS des trois boucles, et c'est une propriété du critère, pas une commodité :
// sur une face sans aire monde le nuanceur intact rend DÉJÀ le vecteur nul, donc la mutation N→0 ne
// change rien et N→−N non plus. Une mutation qu'on ne peut pas voir ne prouve rien ; ces cas-là
// sont éprouvés par leur valeur exacte dans `test/browser/normal-transform-arithmetique.browser.mjs`.
//
// node --experimental-strip-types test/browser/normale-eclairage-substitutions-refusees.browser.mjs
import assert from 'node:assert/strict';
import { verdictNormale } from '../justesse/inverseTransposeF32.mjs';
import {
  APLATIES,
  CAS,
  DECROCHE_DEG,
  EFFONDREES,
  REGULIERE_MINUSCULE,
} from '../justesse/normalTransformCas.mjs';
import { SUBSTITUTIONS, eclairageGpu } from '../justesse/normaleEclairageGpu.mjs';

/** Ordinaires, aplatis et témoin de non-gourmandise : les cas dont la normale a une DIRECTION. */
const TOUS = [...CAS, ...APLATIES, REGULIERE_MINUSCULE];
/** Le nuanceur les voit aussi, pour que le texte exécuté soit exactement celui de l'autre preuve. */
const TOUTES = [...TOUS, ...EFFONDREES];

async function verdicts(substitution) {
  const gpu = await eclairageGpu(TOUTES, { substitution });
  assert.equal(gpu.indisponible ?? null, null, String(gpu.indisponible));
  assert.deepEqual(gpu.compilation ?? [], [], `substitution « ${substitution} » : compilation`);
  assert.deepEqual(gpu.erreurs ?? [], [], `substitution « ${substitution} » : erreurs GPU`);
  return TOUS.map((cas, i) => ({
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
      cas: TOUS.length,
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
  `OK : ${TOUS.length} cas — N→−N refusés ${opposee.length}/${opposee.length}, N→0 refusés ` +
    `${nulle.length}/${nulle.length}, intact accepté ${intacte.length}/${intacte.length}.`,
);
