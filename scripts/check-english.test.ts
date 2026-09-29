import test from 'node:test';
import assert from 'node:assert/strict';
import { countByUnit, frenchByFile, frenchWords, ratchet } from './check-english.ts';

test('French words are found in identifiers, comments and strings, accents and case aside', () => {
  assert.deepEqual(
    frenchWords('const veriteTerrain = SOMMETS_MAX; // le résultat attendu\nlet r = "Largeur";'),
    ['verite', 'sommets', 'resultat', 'attendu', 'largeur'],
  );
  assert.deepEqual(frenchWords('const expected = matrices.copies(); // the result'), []);
});

test('a string that must stay is a named exception, the same word elsewhere counted', () => {
  assert.deepEqual(frenchWords("const dir = '.mesure/out';"), []);
  assert.deepEqual(frenchWords('const mesure = 1;'), ['mesure']);
});

test('the perf measurement format is excepted only as keys and only in its own files', () => {
  const format = 'bench/core/measure.ts';
  assert.deepEqual(
    frenchWords('return { temoin: t, ecartTemoin: e, resultats }; r.medianeMs; m.fichier;', format),
    ['resultats'],
  );
  assert.deepEqual(
    frenchWords("row['temoin'] ?? row.ecartBaseline; x?: { fichier?: 1 }", format),
    [],
  );
  assert.deepEqual(frenchWords('const temoin = 1; // le fichier', format), ['temoin', 'fichier']);
  assert.deepEqual(frenchWords('s.temoinAA; witnessTemoin: 1;', format), ['temoin', 'temoin']);
  assert.deepEqual(frenchWords('gpu.resultats; temoin: 1;', 'tests/browser/probes/a.ts'), [
    'resultats',
    'temoin',
  ]);
  assert.deepEqual(frenchWords("'.mesures/x' + '.mesure/out'"), ['mesures']);
});

test('counts are kept per package, the word list itself left out', () => {
  const found = frenchByFile(
    new Map([
      ['packages/sdk-core/src/a.ts', 'const hauteur = 1;'],
      ['packages/sdk-core/src/b/c.ts', 'const largeur = racine;'],
      ['tests/kit/x.ts', '// obtenu'],
      ['scripts/french-words.ts', 'hauteur largeur'],
      ['site/app/y.ts', 'const height = 1;'],
    ]),
  );
  assert.deepEqual(countByUnit(found), { 'packages/sdk-core': 3, tests: 1 });
});

test('the ratchet fails on a rise, a new package included, and lowers on a fall', () => {
  const baseline = { 'packages/sdk-core': 3, tests: 1 };
  assert.deepEqual(ratchet(baseline, baseline), { risen: [], fallen: false });
  assert.deepEqual(ratchet(baseline, { 'packages/sdk-core': 4, tests: 1 }), {
    risen: ['packages/sdk-core'],
    fallen: false,
  });
  assert.deepEqual(ratchet(baseline, { 'packages/sdk-core': 3, tests: 1, bench: 1 }).risen, [
    'bench',
  ]);
  // A renamed file: its package falls, and one that vanished falls to zero.
  assert.deepEqual(ratchet(baseline, { 'packages/sdk-core': 2 }), { risen: [], fallen: true });
});
