// The witness column of the perf base: a second calculation of the same thing, timed under the
// same settings, read on the row as `ecartTemoin` beside `ecartBaseline` — so every line that
// compares the engine to a host library reads the same way, whatever bench wrote it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mesure } from './mesure.mjs';
import { entete, ligneMd } from './tableau.mjs';

const RAPIDE = { chauffe: 1, tours: 5, budgetMs: 1000 };
const cas = [{ name: 'one case', size: 4, input: 4 }];

test('a witness is timed like the calculation and its median gives ecartTemoin', async () => {
  const { resultats } = await mesure({
    name: 'witnessed',
    fichier: 'packages/sdk-core/bench/socle/mesure.mjs',
    cas,
    options: RAPIDE,
    temoin: (n) => n * 2,
    calcul: (n) => n * 2,
  });
  const [r] = resultats;
  assert.equal(r.temoin.tours, RAPIDE.tours);
  assert.ok(r.temoin.minMs > 0 && r.temoin.medianeMs >= r.temoin.minMs);
  assert.equal(r.ecartTemoin, (r.medianeMs - r.temoin.medianeMs) / r.temoin.medianeMs);
});

test('without a witness the row says so with null, never zero; an untimed case too', async () => {
  const conf = { fichier: 'packages/sdk-core/bench/socle/mesure.mjs', options: RAPIDE };
  const alone = await mesure({ ...conf, name: 'alone', cas, calcul: (n) => n });
  const untimed = await mesure({
    ...conf,
    name: 'untimed',
    cas: [{ name: 'untimed', input: 4, mesure: false }],
    temoin: (n) => n,
    calcul: (n) => n,
    attendu: (n) => n,
  });
  for (const r of [alone.resultats[0], untimed.resultats[0]]) {
    assert.equal(r.temoin, null);
    assert.equal(r.ecartTemoin, null);
  }
  assert.equal(untimed.resultats[0].correct, true);
});

test('the oracle may read what the witness wrote: the witness runs once before it', async () => {
  const written = new Float64Array(1);
  const { resultats } = await mesure({
    name: 'witness result as oracle',
    fichier: 'packages/sdk-core/bench/socle/mesure.mjs',
    cas,
    options: RAPIDE,
    temoin: (n) => (written[0] = n * 3),
    attendu: () => written,
    calcul: (n) => Float64Array.of(n * 3),
  });
  assert.equal(resultats[0].correct, true, resultats[0].difference);
});

test('the table prints the witness gap after the baseline gap, without a regression icon', () => {
  assert.match(entete()[0], /\| vs baseline \| vs witness \| Oracle \|/);
  const row = {
    name: 'r',
    medianeMs: 1,
    p95Ms: 1,
    nsParElement: null,
    opsParSec: 1000,
    ecartBaseline: 0.3,
    ecartTemoin: -0.5,
    correct: true,
    motif: null,
  };
  assert.match(ligneMd(row, { pastilles: true }), /\| 🔴 \+30\.0 % \| -50\.0 % \| ✓ \|/);
  assert.match(ligneMd({ ...row, ecartTemoin: null }), /\| \+30\.0 % \| — \| ✓ \|/);
});
