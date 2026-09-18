// Les passes de la carte graphique résumées par le harnais : une distribution par passe, une par
// bloc comparable, et « aucun relevé » qui reste `null` — jamais un zéro ni un tableau vide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { passesGpu } from './seriePasses.mjs';
import { passes } from './rapportPasses.mjs';

const releve = (frame, liste, truncated = false) => ({
  frame,
  totalMs: null,
  truncated,
  passes: liste.map(([name, gpuMs]) => ({ name, gpuMs })),
});

test('chaque passe a sa distribution, chaque bloc la sienne, sur les relevés où tout est mesuré', () => {
  const resume = passesGpu([
    releve(12, [
      ['WG DAG selection', 0.25],
      ['WG visibility primary', 1],
      ['WG material surfaces v1', 2],
      ['WG deferred lighting', 6],
    ]),
    releve(24, [
      ['WG DAG selection', 0.75],
      ['WG visibility primary', 1.5],
      ['WG material surfaces v1', 2.5],
      ['WG deferred lighting', 7],
    ]),
    releve(36, [
      ['WG DAG selection', null],
      ['WG visibility primary', 2],
      ['WG material surfaces v1', 3],
      ['WG deferred lighting', 8],
    ]),
  ]);
  assert.equal(resume.releves, 3);
  const parNom = Object.fromEntries(resume.passes.map((p) => [p.name, p]));
  // Le rang p50 du harnais est celui de `summarize` : sur deux valeurs, la plus basse.
  assert.deepEqual(
    [parNom['WG DAG selection'].gpuMs.p50, parNom['WG DAG selection'].gpuMs.max],
    [0.25, 0.75],
    'le relevé sans durée ne compte pas pour zéro',
  );
  assert.equal(parNom['WG DAG selection'].bloc, 'visibility');
  assert.equal(parNom['WG deferred lighting'].bloc, 'other');
  assert.equal(resume.passes[0].name, 'WG deferred lighting', 'la plus lourde d’abord');
  // Le bloc visibilité n'est mesuré que sur les deux relevés où la sélection a une durée.
  assert.deepEqual([resume.blocs.visibilityMs.p50, resume.blocs.visibilityMs.max], [1.25, 2.25]);
  assert.equal(resume.blocs.materialsMs.p50, 2.5, 'les trois relevés comptent pour ce bloc');
  assert.equal(resume.blocs.otherMs.p50, 7);
});

test('un relevé tronqué est ignoré en entier, et sans aucun relevé le résumé est null', () => {
  const resume = passesGpu([
    releve(12, [['WG visibility primary', 1]], true),
    releve(24, [['WG visibility primary', 3.0]]),
  ]);
  assert.equal(resume.releves, 2);
  assert.equal(resume.passes[0].gpuMs.p50, 3.0);
  assert.equal(passesGpu([]), null);
  assert.equal(passesGpu(undefined), null);
});

test('le résumé lisible nomme les blocs en millisecondes p50/p95 et « non mesuré » sans inventer', () => {
  const lignes = passes(
    passesGpu([
      releve(12, [
        ['WG visibility primary', 1.234],
        ['WG material surfaces v1', null],
      ]),
    ]),
  );
  assert.match(lignes[0], /Tampon de visibilité 1\.234 \/ 1\.234/);
  assert.match(lignes[0], /Passe matériaux non mesuré/);
  assert.match(lignes[0], /Le reste non mesuré/);
  assert.ok(lignes.includes('| WG visibility primary | 1.234 / 1.234 | visibility |'));
  assert.deepEqual(passes(null), ['- Passes carte graphique : aucun relevé', '']);
});
