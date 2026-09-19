// Regression verdict, and the only place where its thresholds are defined.
//
// They previously existed in three copies: `compareBaseline`, which no one called, and two sets in
// `agrege.mjs` — one for table status icons (⚠️ beyond 10%, 🔴 beyond 25%),
// the other for its summary, which counted as "regression" anything exceeding 10%. The same discrepancy of
// +14% displayed as a warning in the table and counted as a regression in the
// summary conclusion of that same table. This test holds the rule in a single place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBaseline, niveauEcart, SEUIL_AVERTISSEMENT, SEUIL_ECHEC } from './baseline.mjs';

const cas = (name, ecartBaseline) => ({ name, ecartBaseline });

test('a discrepancy falls into a single level, and boundaries belong to the lower level', () => {
  assert.equal(niveauEcart(null), 'absent', 'no baseline for this case');
  assert.equal(niveauEcart(undefined), 'absent');
  assert.equal(niveauEcart(NaN), 'absent');
  assert.equal(niveauEcart(-0.4), 'ok', 'an acceleration is not a regression');
  assert.equal(niveauEcart(0), 'ok');
  // Thresholds are STRICT bounds: exactly 10% stays ok, a hair above does not.
  assert.equal(niveauEcart(SEUIL_AVERTISSEMENT), 'ok');
  assert.equal(niveauEcart(SEUIL_AVERTISSEMENT + 1e-9), 'avertissement');
  assert.equal(niveauEcart(SEUIL_ECHEC), 'avertissement');
  assert.equal(niveauEcart(SEUIL_ECHEC + 1e-9), 'echec');
});

test('the verdict of a batch is that of its worst case, and it counts each case only once', () => {
  const bilan = compareBaseline([
    cas('faster', -0.5),
    cas('stable', 0.02),
    cas('slow', 0.14),
    cas('very slow', 0.4),
    cas('no baseline', null),
  ]);
  assert.equal(bilan.verdict, 'echec');
  assert.equal(bilan.compares, 4, 'case without baseline is not compared');
  assert.deepEqual(
    bilan.regressions.map((r) => r.name),
    ['very slow'],
  );
  assert.deepEqual(
    bilan.avertissements.map((r) => r.name),
    ['slow'],
  );
  // A case is never in both lists: this was causing the table and summary to diverge.
  const nommes = [...bilan.regressions, ...bilan.avertissements].map((r) => r.name);
  assert.equal(new Set(nommes).size, nommes.length);
});

test('without warning or regression, verdict is ok; without any baseline, it is absent', () => {
  assert.equal(compareBaseline([cas('a', 0), cas('b', -0.2)]).verdict, 'ok');
  const rien = compareBaseline([cas('a', null), cas('b', null)]);
  assert.equal(rien.verdict, 'absent', 'no baseline: nothing to conclude');
  assert.equal(rien.compares, 0);
  assert.equal(compareBaseline([]).verdict, 'absent');
});

test('published thresholds are those applied by verdict, and caller can tighten them', () => {
  const bilan = compareBaseline([cas('a', 0.14)]);
  assert.equal(bilan.seuilAvertissement, SEUIL_AVERTISSEMENT);
  assert.equal(bilan.seuilEchec, SEUIL_ECHEC);
  // Summary prints these two numbers: publishing them prevents manual rewriting.
  const serre = compareBaseline([cas('a', 0.14)], { seuilAvertissement: 0.05, seuilEchec: 0.1 });
  assert.equal(serre.verdict, 'echec');
  assert.equal(serre.seuilEchec, 0.1);
});
