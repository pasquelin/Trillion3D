// Défaut 9 (`NORMAL_TRANSFORM_WGSL`, standardLighting.ts) : la transformation des normales
// d'éclairage portait sa propre copie de `inverseTranspose3`, avec le seuil absolu `abs(det)<1e-20`
// sur le déterminant brut que le défaut 6 avait déjà corrigé dans le noyau de sélection. Une
// rotation d'échelle uniforme s a pour déterminant ±s³ : dès s ≲ 2,15e-7 la normale rendue était la
// normale LOCALE, non tournée, et la surface était éclairée comme si elle n'avait pas tourné.
//
// CE QUE CE FICHIER TIENT, ET COMMENT. Il ne lit plus le texte du nuanceur à coups de motifs : une
// suite d'`assert.match` sur du WGSL casse au premier reformatage et ne garantit aucune
// arithmétique. Il éprouve le CALCUL — `xformNormal` = uniteOuZero(inverseTranspose3(mat3(world), n))
// — sur le modèle f32 de `test/justesse/inverseTransposeF32.mjs` : la rotation suivie à toute
// échelle, les poses singulières — aplaties puis effondrées — et le seuil franchi des deux côtés.
// Ce modèle n'est pas le nuanceur : `test/normalTransformArithmetique.browser.mjs` exécute le texte
// livré dans Chromium WebGPU sur EXACTEMENT ces cas (`test/justesse/normalTransformCas.mjs`) et
// exige qu'il rende ce que le modèle rend — c'est là, aussi, qu'un nuanceur qui ne compile pas fait
// échouer la preuve. Restent ici les seuls contrôles de texte qui portent sur la COMPILATION et
// l'écriture unique : une déclaration en double ne compilerait pas, et deux copies de
// l'arithmétique dériveraient l'une de l'autre — c'était exactement le défaut 9. Le CRITÈRE qui
// juge une normale rendue est éprouvé à part, dans `normalTransformCritere.test.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INVERSE_TRANSPOSE_WGSL } from './inverseTransposeWgsl.ts';
import { NORMAL_TRANSFORM_WGSL } from './standardLighting.ts';
import { DAG_SELECTION_SHADER } from './gpuDagShader.ts';
import {
  angleEntre,
  unitaire,
  verdictNormale,
  xformNormalAvantLeLot,
  xformNormalModele,
} from '../../test/justesse/inverseTransposeF32.mjs';
import {
  APLATIES,
  CAS,
  DECROCHE_DEG,
  DEG,
  EFFONDREES,
  REGULIERE_MINUSCULE,
  SEUIL,
} from '../../test/justesse/normalTransformCas.mjs';

/** Le verdict — direction orientée, vecteur nul refusé, norme unitaire — d'une écriture sur un cas. */
const verdict = (cas: { vraie: number[] }, rendue: number[]) =>
  verdictNormale(rendue, cas.vraie, DECROCHE_DEG);

test('la normale d’éclairage suit la rotation à toute échelle, de 1e3 à 1e-16', () => {
  assert.ok(CAS.length >= 300, `échantillon trop petit : ${CAS.length}`);
  for (const cas of CAS) {
    const v = verdict(cas, xformNormalModele(cas.world, cas.normale));
    assert.ok(v.ok, `${cas.nom} : ${v.raison}`);
  }
  // Sans rotation effective, ces cas ne prouveraient rien : la normale vraie doit avoir bougé.
  const tournees = CAS.filter(
    (cas: { vraie: number[]; normale: number[] }) => angleEntre(cas.vraie, cas.normale) * DEG > 10,
  ).length;
  assert.ok(tournees > CAS.length / 2, `${tournees} cas seulement font tourner la normale`);
});

test('le seuil absolu d’avant le lot décrochait, et exactement sous s³ = 1e-20', () => {
  const decroches = CAS.filter(
    (cas: { world: number[]; normale: number[]; vraie: number[] }) =>
      !verdict(cas, xformNormalAvantLeLot(cas.world, cas.normale)).ok,
  );
  assert.ok(decroches.length > 0, 'la reproduction ne reproduit plus : cas à revoir');
  // Ce que le lot devait changer, et rien d'autre : au-dessus du seuil, l'ancienne écriture était
  // déjà juste. Un décrochage hors bande voudrait dire que le défaut n'était pas celui qu'on croit.
  for (const cas of decroches)
    assert.ok(
      cas.s < SEUIL,
      `${cas.nom} : décrochage hors de la bande du seuil (s = ${cas.s} ≥ ${SEUIL})`,
    );
  // Et de part et d'autre du seuil, le comportement bascule : 2,154e-7 dedans, 2,16e-7 dehors.
  // Sans ces deux échelles, la borne ne serait pas éprouvée, seulement franchie de loin.
  const a = (s: number) => decroches.some((cas: { s: number }) => cas.s === s);
  assert.ok(a(2.154e-7), 'juste sous le seuil : la forme d’avant aurait dû décrocher');
  assert.ok(!a(2.16e-7), 'juste au-dessus du seuil : la forme d’avant ne devait pas décrocher');
});

test('hors de la bande du seuil, le lot n’a pas bougé la normale rendue', () => {
  for (const cas of CAS.filter((c: { s: number }) => c.s >= 1e-6)) {
    const ecart =
      angleEntre(
        xformNormalModele(cas.world, cas.normale),
        xformNormalAvantLeLot(cas.world, cas.normale),
      ) * DEG;
    assert.ok(ecart < 1e-4, `${cas.nom} : la normale a bougé de ${ecart}° hors de la bande`);
  }
});

test('poses singulières : la face aplatie garde sa normale, la face effondrée n’en a plus', () => {
  // Une attente par cas, calculée à la main dans `normalTransformCas.mjs` : le produit vectoriel
  // des arêtes transformées pour les rang 2, le vecteur nul pour les effondrées. L'ancienne attente
  // — la normale LOCALE rendue telle quelle — décrivait le défaut, pas la convention : sur
  // `échelle (1,1,0) puis 90° autour de Y` elle laissait +Z là où la face transformée regarde +X.
  for (const cas of APLATIES) {
    const v = verdict(cas, xformNormalModele(cas.world, cas.normale));
    assert.ok(v.ok, `${cas.nom} : ${v.raison}`);
    const ecart = angleEntre(cas.vraie, unitaire(cas.normale)) * DEG;
    assert.ok(
      ecart > 10,
      `${cas.nom} : la normale locale et la vraie ne diffèrent que de ${ecart}°`,
    );
  }
  for (const cas of EFFONDREES)
    assert.deepEqual(
      xformNormalModele(cas.world, cas.normale),
      [0, 0, 0],
      `${cas.nom} : une face sans aire monde ne s'éclaire pas — zéro, jamais un NaN ni la locale`,
    );
  // Et le garde ne doit pas être gourmand : une matrice minuscule mais régulière passe.
  const v = verdict(
    REGULIERE_MINUSCULE,
    xformNormalModele(REGULIERE_MINUSCULE.world, REGULIERE_MINUSCULE.normale),
  );
  assert.ok(v.ok, `${REGULIERE_MINUSCULE.nom} : prise par le garde — ${v.raison}`);
});

// --- Écriture unique et compilation --------------------------------------------------------------
const occurrences = (texte: string, motif: RegExp) => texte.match(motif)?.length ?? 0;

test('le noyau de sélection et l’éclairage lisent la même écriture, au caractère près', () => {
  for (const [nom, shader] of [
    ['éclairage', NORMAL_TRANSFORM_WGSL],
    ['sélection du DAG', DAG_SELECTION_SHADER],
  ] as const) {
    assert.ok(shader.includes(INVERSE_TRANSPOSE_WGSL), `${nom} : texte partagé absent`);
    for (const fonction of [
      'inverseTranspose3',
      'invTranspose3Prep',
      'invTranspose3Apply',
      'uniteOuZero',
    ])
      assert.equal(
        occurrences(shader, new RegExp(`fn ${fonction}\\(`, 'g')),
        1,
        `${nom} : « fn ${fonction} » déclarée en double, le module WGSL ne compilerait pas`,
      );
  }
});

test('la normale d’éclairage passe par l’inverse-transposée partagée, sans la recalculer', () => {
  const corps = NORMAL_TRANSFORM_WGSL.split('fn xformNormal')[1].split('\n}')[0];
  assert.equal(occurrences(NORMAL_TRANSFORM_WGSL, /fn xformNormal\(/g), 1, 'xformNormal en double');
  assert.ok(corps.includes('inverseTranspose3('), 'xformNormal n’appelle plus le noyau partagé');
  assert.ok(
    corps.includes('uniteOuZero('),
    'xformNormal doit rendre une direction unitaire ou nulle',
  );
  assert.doesNotMatch(
    corps,
    /\bdet\b|cross\(/,
    'xformNormal recalcule l’inverse-transposée au lieu de l’appeler : c’était le défaut 9',
  );
});
