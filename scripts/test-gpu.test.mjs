import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BROWSER_GPU_TESTS, RACINE, buildTestGpuArgs, listJustesseTests } from './test-gpu.mjs';

test('listJustesseTests retient exactement les sondes tiretées de test/justesse', () => {
  const sondes = listJustesseTests();
  const attendues = readdirSync(join(RACINE, 'test/justesse')).filter(
    (f) => f.includes('-') && f.endsWith('.mjs'),
  );
  assert.equal(sondes.length, attendues.length);
  assert.ok(sondes.length > 0, 'aucune sonde trouvée');
  for (const sonde of sondes) {
    assert.match(sonde, /^test\/justesse\/.*-.*\.mjs$/);
    assert.ok(existsSync(join(RACINE, sonde)), `${sonde} n'existe pas`);
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
