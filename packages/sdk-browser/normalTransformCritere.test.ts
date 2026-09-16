// LE CRITÈRE des preuves de normale, éprouvé sur des vecteurs choisis à la main, sans passer par le
// noyau. `angleEntre` et `verdictNormale` (`bench/justesse/inverseTransposeF32.mjs`) décident si une
// normale rendue est la bonne : tant qu'ils acceptent une normale retournée ou perdue, aucune des
// preuves qui s'appuient sur eux — `normalTransform.test.ts` sans GPU,
// `test/normalTransformArithmetique.browser.mjs` sur GPU réel — ne prouve quoi que ce soit. C'était
// le cas : une valeur absolue sur le produit scalaire confondait N et −N, et `atan2(0, 0) = 0`
// déclarait juste une normale que le nuanceur avait perdue.
//
// Séparé de `normalTransform.test.ts` par responsabilité : là-bas l'arithmétique du noyau, ici
// l'instrument qui la juge.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  angleEntre,
  TOLERANCE_NORME,
  verdictNormale,
  xformNormalModele,
} from './bench/justesse/inverseTransposeF32.mjs';
import { DECROCHE_DEG, REGULIERE_MINUSCULE } from './bench/justesse/normalTransformCas.mjs';

/** Le verdict — direction orientée, vecteur nul refusé, norme unitaire — d'une écriture sur un cas. */
const verdict = (cas: { vraie: number[] }, rendue: number[]) =>
  verdictNormale(rendue, cas.vraie, DECROCHE_DEG);

test('angleEntre/verdictNormale : direction ORIENTÉE, N et −N ne sont plus confondus (justesse)', () => {
  const N = [0, 0, 1];
  const moinsN = [0, 0, -1];
  assert.ok(Math.abs(angleEntre(N, N)) < 1e-12, 'deux directions identiques : angle nul');
  assert.ok(
    Math.abs(angleEntre(N, moinsN) - Math.PI) < 1e-12,
    'deux directions opposées : π, pas 0 comme sous une valeur absolue du produit scalaire',
  );
  const oppose = verdict({ vraie: N }, moinsN);
  assert.ok(!oppose.ok, 'une normale rendue opposée à l’attendue doit être refusée');
  assert.ok(Math.abs(oppose.ecartDeg - 180) < 1e-9, `écart ${oppose.ecartDeg}°, attendu 180°`);
});

test('angleEntre/verdictNormale : vecteur nul ou non fini rend NaN, jamais 0 (justesse)', () => {
  for (const v of [
    [0, 0, 0],
    [NaN, 0, 0],
    [Infinity, 0, 0],
    [0, -Infinity, 0],
  ])
    assert.ok(Number.isNaN(angleEntre(v, [0, 0, 1])), `angleEntre([${v}], N) doit être NaN`);
  const rendueNulle = verdict({ vraie: [0, 0, 1] }, [0, 0, 0]);
  assert.ok(!rendueNulle.ok, 'un vecteur nul est refusé, jamais accepté à 0°');
  assert.ok(Number.isNaN(rendueNulle.ecartDeg), 'écart NaN, jamais 0° comme atan2(0, 0)');
  assert.match(rendueNulle.raison ?? '', /sans direction/, `raison : ${rendueNulle.raison}`);
});

test('verdictNormale : une norme hors tolérance est refusée même dans la bonne direction (justesse)', () => {
  const tropCourte = verdict({ vraie: [0, 0, 1] }, [0, 0, 0.9]);
  assert.ok(
    !tropCourte.ok,
    'une normale non unitaire doit être refusée, même parfaitement alignée',
  );
  assert.match(tropCourte.raison ?? '', /norme/, `raison inattendue : ${tropCourte.raison}`);
  const dansLaTolerance = verdict({ vraie: [0, 0, 1] }, [0, 0, 1 + 1e-7]);
  assert.ok(dansLaTolerance.ok, `1e-7 sous ${TOLERANCE_NORME} : ne doit pas être refusée`);
});

test(
  'REGULIERE_MINUSCULE : inverse-transposée calculée à la main, indépendamment du noyau, donne ' +
    '[0,6 ; 0,8 ; 0] (justesse géométrique)',
  () => {
    // diag(1e-8, −1e-8, −1e-8) est sa propre transposée ; son inverse est diag(1e8, −1e8, −1e8).
    // Appliquée à la normale locale [0,6, −0,8, 0] : [0,6·1e8, −0,8·(−1e8), 0] = [6e7, 8e7, 0].
    // Arithmétique double ordinaire, sans `Math.fround` ni `cofacteur` : ce calcul ne réutilise rien
    // du noyau éprouvé, il en est le témoin indépendant.
    const brut = [0.6 * 1e8, -0.8 * -1e8, 0];
    const norme = Math.hypot(brut[0], brut[1], brut[2]);
    const main = [brut[0] / norme, brut[1] / norme, brut[2] / norme];
    assert.deepEqual(
      main,
      [0.6, 0.8, 0],
      'le calcul à la main ne tombe pas sur la valeur attendue',
    );
    assert.deepEqual(REGULIERE_MINUSCULE.vraie, main, 'le témoin s’écarte de la valeur à la main');
    const rendue = xformNormalModele(REGULIERE_MINUSCULE.world, REGULIERE_MINUSCULE.normale);
    const v = verdictNormale(rendue, main, DECROCHE_DEG);
    assert.ok(
      v.ok,
      `${REGULIERE_MINUSCULE.nom} : le noyau rend [${rendue}], au lieu de [${main}] — ${v.raison}`,
    );
  },
);
