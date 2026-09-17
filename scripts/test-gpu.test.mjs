import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BROWSER_GPU_TESTS, RACINE, buildTestGpuArgs, listJustesseTests } from './test-gpu.mjs';

test('chaque sonde listée existe et porte le nom que la convention exige', () => {
  const sondes = listJustesseTests();
  assert.ok(sondes.length > 0, 'aucune sonde trouvée');
  for (const sonde of sondes) {
    assert.match(sonde, /^test\/justesse\/.*-.*\.mjs$/);
    assert.ok(existsSync(join(RACINE, sonde)), `${sonde} n'existe pas`);
  }
});

// La garde qui compte : un fichier de `test/justesse/` que le tiret écarte doit être le module
// d'appui de quelqu'un — importé, ou donné en entrée à esbuild pour la page du navigateur. Sans
// elle, une sonde mal nommée ne serait jamais lancée, en silence. Répliquer ici le filtre de
// `listJustesseTests` ne l'attraperait pas : le test se comparerait au code qu'il vérifie.
test('aucun fichier de test/justesse ne reste orphelin : lancé, ou nommé par une sonde', () => {
  const dossier = join(RACINE, 'test/justesse');
  const tous = readdirSync(dossier).filter((f) => f.endsWith('.mjs'));
  const lances = new Set(listJustesseTests().map((s) => s.slice('test/justesse/'.length)));
  // Les consommateurs d'un module d'appui ne sont pas tous dans le dossier : les jeux de cas
  // partagés sont relus par des tests unitaires et par les tests de rendu.
  const suivis = execFileSync('git', ['ls-files'], { cwd: RACINE, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((f) => /\.(mjs|ts|mts)$/.test(f));
  const textes = new Map(suivis.map((f) => [f, readFileSync(join(RACINE, f), 'utf8')]));
  for (const fichier of tous) {
    if (lances.has(fichier)) continue;
    const nomme = suivis.some(
      (autre) => !autre.endsWith(`/${fichier}`) && textes.get(autre).includes(fichier),
    );
    assert.ok(nomme, `${fichier} n'est ni lancé ni nommé ailleurs : il ne s'exécute jamais`);
  }
});

test('chaque test de rendu listé existe sur le disque', () => {
  for (const cible of BROWSER_GPU_TESTS)
    assert.ok(existsSync(join(RACINE, cible)), `${cible} n'existe pas`);
});

test('buildTestGpuArgs construit la liste complète par défaut, en série', () => {
  const args = buildTestGpuArgs([]);
  assert.deepEqual(args.slice(0, 3), [
    '--experimental-strip-types',
    '--test',
    '--test-concurrency=1',
  ]);
  assert.ok(args.includes('test/browser/cisaillementTransform.browser.mjs'));
  assert.ok(args.some((a) => a.includes('erreur-ecran-borne.mjs')));
  assert.equal(args.length, 3 + listJustesseTests().length + BROWSER_GPU_TESTS.length);
});

test('buildTestGpuArgs transmet les cibles fournies en ligne de commande', () => {
  assert.deepEqual(buildTestGpuArgs(['test/justesse/reflexion-cone.mjs']), [
    '--experimental-strip-types',
    '--test',
    '--test-concurrency=1',
    'test/justesse/reflexion-cone.mjs',
  ]);
});
