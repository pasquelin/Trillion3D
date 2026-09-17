// Le verdict d'une régression, et le seul endroit où ses seuils sont écrits.
//
// Ils vivaient en trois exemplaires : `compareBaseline`, que personne n'appelait, et deux jeux dans
// `agrege.mjs` — l'un pour les pastilles du tableau (⚠️ au-delà de 10 %, 🔴 au-delà de 25 %),
// l'autre pour son résumé, qui comptait « régression » tout ce qui dépassait 10 %. Le même écart de
// +14 % s'affichait donc en avertissement dans le tableau et se comptait comme régression dans la
// conclusion de ce même tableau. Ce test tient la règle en un seul endroit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareBaseline,
  niveauEcart,
  SEUIL_AVERTISSEMENT,
  SEUIL_ECHEC,
} from '../../packages/sdk-core/bench/baseline.mjs';

const cas = (nom, ecartBaseline) => ({ nom, ecartBaseline });

test('un écart tombe dans un seul niveau, et les bornes appartiennent au niveau du dessous', () => {
  assert.equal(niveauEcart(null), 'absent', 'pas de baseline pour ce cas');
  assert.equal(niveauEcart(undefined), 'absent');
  assert.equal(niveauEcart(NaN), 'absent');
  assert.equal(niveauEcart(-0.4), 'ok', 'une accélération n’est pas une régression');
  assert.equal(niveauEcart(0), 'ok');
  // Les seuils sont des bornes STRICTES : exactement 10 % reste correct, un cheveu au-dessus non.
  assert.equal(niveauEcart(SEUIL_AVERTISSEMENT), 'ok');
  assert.equal(niveauEcart(SEUIL_AVERTISSEMENT + 1e-9), 'avertissement');
  assert.equal(niveauEcart(SEUIL_ECHEC), 'avertissement');
  assert.equal(niveauEcart(SEUIL_ECHEC + 1e-9), 'echec');
});

test('le verdict d’un lot est celui de son pire cas, et il ne compte chaque cas qu’une fois', () => {
  const bilan = compareBaseline([
    cas('accéléré', -0.5),
    cas('stable', 0.02),
    cas('lent', 0.14),
    cas('très lent', 0.4),
    cas('sans baseline', null),
  ]);
  assert.equal(bilan.verdict, 'echec');
  assert.equal(bilan.compares, 4, 'le cas sans baseline n’est pas comparé');
  assert.deepEqual(
    bilan.regressions.map((r) => r.nom),
    ['très lent'],
  );
  assert.deepEqual(
    bilan.avertissements.map((r) => r.nom),
    ['lent'],
  );
  // Un cas n'est jamais dans les deux listes : c'est ce qui faisait diverger le tableau du résumé.
  const nommes = [...bilan.regressions, ...bilan.avertissements].map((r) => r.nom);
  assert.equal(new Set(nommes).size, nommes.length);
});

test('sans avertissement ni régression, le verdict est ok ; sans baseline du tout, il est absent', () => {
  assert.equal(compareBaseline([cas('a', 0), cas('b', -0.2)]).verdict, 'ok');
  const rien = compareBaseline([cas('a', null), cas('b', null)]);
  assert.equal(rien.verdict, 'absent', 'aucune baseline : il n’y a rien à conclure');
  assert.equal(rien.compares, 0);
  assert.equal(compareBaseline([]).verdict, 'absent');
});

test('les seuils publiés sont ceux que le verdict applique, et l’appelant peut les resserrer', () => {
  const bilan = compareBaseline([cas('a', 0.14)]);
  assert.equal(bilan.seuilAvertissement, SEUIL_AVERTISSEMENT);
  assert.equal(bilan.seuilEchec, SEUIL_ECHEC);
  // Le résumé imprime ces deux nombres : les publier évite qu'il en réécrive d'autres à la main.
  const serre = compareBaseline([cas('a', 0.14)], { seuilAvertissement: 0.05, seuilEchec: 0.1 });
  assert.equal(serre.verdict, 'echec');
  assert.equal(serre.seuilEchec, 0.1);
});
