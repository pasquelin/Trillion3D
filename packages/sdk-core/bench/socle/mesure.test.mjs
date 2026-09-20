// The witness of the perf base: a second calculation of the same thing, timed under the same
// settings, read on the row as `ecartTemoin` beside `ecartBaseline` — so every line that compares
// the engine to a host library reads the same way, whatever bench wrote it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mesure } from './mesure.mjs';

const conf = {
  fichier: 'packages/sdk-core/bench/socle/mesure.mjs',
  options: { chauffe: 1, tours: 5, budgetMs: 1000 },
};
const cas = [{ name: 'one case', size: 4, input: 4 }];
/** Enough work for the clock to see it, whatever its resolution. */
const travail = (n) => {
  let s = 0;
  for (let i = 0; i < 400; i++) s += Math.sqrt(i * n);
  return s;
};

test('a witness is timed like the calculation, and its median gives ecartTemoin', async () => {
  const { resultats } = await mesure({
    ...conf,
    name: 'witnessed',
    cas,
    temoin: travail,
    calcul: travail,
  });
  const [r] = resultats;
  assert.equal(r.temoin.tours, conf.options.tours);
  assert.ok(r.temoin.medianeMs > 0);
  assert.ok(Number.isFinite(r.ecartTemoin), `ecartTemoin ${r.ecartTemoin}`);
});

test('without a witness the row says so with null, never zero; an untimed case too', async () => {
  const alone = await mesure({ ...conf, name: 'alone', cas, calcul: travail });
  const untimed = await mesure({
    ...conf,
    name: 'untimed',
    cas: [{ name: 'untimed', input: 4, mesure: false }],
    temoin: travail,
    calcul: travail,
    attendu: travail,
  });
  for (const r of [alone.resultats[0], untimed.resultats[0]]) {
    assert.equal(r.temoin, null);
    assert.equal(r.ecartTemoin, null);
  }
  assert.equal(untimed.resultats[0].correct, true);
});
