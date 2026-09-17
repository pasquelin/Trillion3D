import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_GPU_TESTS, buildTestGpuArgs, listJustesseTests } from './test-gpu.mjs';

test('listJustesseTests retient tous les scripts exécutables tiretés de test/justesse', () => {
  const tests = listJustesseTests();
  assert.ok(tests.length >= 15, 'au moins 15 scripts de justesse');
  for (const t of tests) {
    assert.match(t, /^test\/justesse\/.*-.*\.mjs$/);
  }
});

test('buildTestGpuArgs construit la liste complète par défaut avec test-concurrency=1', () => {
  const args = buildTestGpuArgs([]);
  assert.equal(args[0], '--experimental-strip-types');
  assert.equal(args[1], '--test');
  assert.equal(args[2], '--test-concurrency=1');
  assert.ok(args.includes('test/cisaillementTransform.browser.mjs'));
  assert.ok(args.some((a) => a.includes('erreur-ecran-borne.mjs')));
  assert.equal(
    args.length,
    3 + listJustesseTests().length + BROWSER_GPU_TESTS.length,
  );
});

test('buildTestGpuArgs transmet les arguments ciblés fournis en ligne de commande', () => {
  const args = buildTestGpuArgs(['test/justesse/reflexion-cone.mjs']);
  assert.deepEqual(args, [
    '--experimental-strip-types',
    '--test',
    '--test-concurrency=1',
    'test/justesse/reflexion-cone.mjs',
  ]);
});
