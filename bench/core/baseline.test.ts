// Regression verdict, and the only place where its thresholds are defined.
//
// They previously existed in three copies: `compareBaseline`, which no one called, and two sets in
// `aggregate.ts` — one for table status icons (⚠️ beyond 10%, 🔴 beyond 25%),
// the other for its summary, which counted as "regression" anything exceeding 10%. The same discrepancy of
// +14% displayed as a warning in the table and counted as a regression in the
// summary conclusion of that same table. This test holds the rule in a single place.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareBaseline,
  relativeGap,
  gapLevel,
  WARNING_THRESHOLD,
  FAILURE_THRESHOLD,
} from './baseline.ts';

const cas = (name: string, gapBaseline: number | null) => ({ name, ecartBaseline: gapBaseline });

test('a discrepancy falls into a single level, and boundaries belong to the lower level', () => {
  assert.equal(gapLevel(null), 'absent', 'no baseline for this case');
  assert.equal(gapLevel(undefined), 'absent');
  assert.equal(gapLevel(NaN), 'absent');
  assert.equal(gapLevel(-0.4), 'ok', 'an acceleration is not a regression');
  assert.equal(gapLevel(0), 'ok');
  // Thresholds are STRICT bounds: exactly 10% stays ok, a hair above does not.
  assert.equal(gapLevel(WARNING_THRESHOLD), 'ok');
  assert.equal(gapLevel(WARNING_THRESHOLD + 1e-9), 'avertissement');
  assert.equal(gapLevel(FAILURE_THRESHOLD), 'avertissement');
  assert.equal(gapLevel(FAILURE_THRESHOLD + 1e-9), 'echec');
});

test('the verdict of a batch is that of its worst case, and it counts each case only once', () => {
  const tally = compareBaseline([
    cas('faster', -0.5),
    cas('stable', 0.02),
    cas('slow', 0.14),
    cas('very slow', 0.4),
    cas('no baseline', null),
  ]);
  assert.equal(tally.verdict, 'echec');
  assert.equal(tally.compares, 4, 'case without baseline is not compared');
  assert.deepEqual(
    tally.regressions.map((r) => r.name),
    ['very slow'],
  );
  assert.deepEqual(
    tally.warnings.map((r) => r.name),
    ['slow'],
  );
  // A case is never in both lists: this was causing the table and summary to diverge.
  const nommes = [...tally.regressions, ...tally.warnings].map((r) => r.name);
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
  const tally = compareBaseline([cas('a', 0.14)]);
  assert.equal(tally.warningThreshold, WARNING_THRESHOLD);
  assert.equal(tally.failureThreshold, FAILURE_THRESHOLD);
  // Summary prints these two numbers: publishing them prevents manual rewriting.
  const serre = compareBaseline([cas('a', 0.14)], {
    warningThreshold: 0.05,
    failureThreshold: 0.1,
  });
  assert.equal(serre.verdict, 'echec');
  assert.equal(serre.failureThreshold, 0.1);
});

test('a relative gap reads a median against its reference, and null without one', () => {
  assert.equal(relativeGap(1.5, 1), 0.5);
  assert.equal(relativeGap(0.5, 2), -0.75);
  assert.equal(relativeGap(1, null), null, 'no reference: nothing compared');
  assert.equal(relativeGap(null, 1), null, 'no measure: nothing compared');
  assert.equal(relativeGap(1, 0), null, 'a zero reference is not a reference');
});
