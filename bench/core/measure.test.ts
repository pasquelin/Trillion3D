// The witness of the perf base (`docs/TESTS.md`): timed like the calculation, read on the row as
// `ecartTemoin`; `null` on a row without one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mesure } from './measure.ts';

const conf = {
  fichier: 'bench/core/measure.ts',
  options: { chauffe: 1, tours: 5 },
};
const cas = [{ name: 'one case', size: 4, input: 4 }];
/** Enough work for the clock to see it, whatever its resolution. */
const travail = (n: number) => {
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
  assert.ok(r.temoin);
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
