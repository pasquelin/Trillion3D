import test from 'node:test';
import assert from 'node:assert/strict';
import type { GpuPassTimings } from '../sdk-core/index.ts';
import { gpuPassBlockOf, gpuPassBlockTotals } from './gpuPassBlocks.ts';

const sample = (
  passes: Array<[string, number | null]>,
  extra: Partial<GpuPassTimings> = {},
): GpuPassTimings => ({
  frame: 7,
  totalMs: null,
  truncated: false,
  passes: passes.map(([name, gpuMs]) => ({ name, gpuMs })),
  ...extra,
});

test('chaque passe tombe dans le bloc que son étiquette nomme, et une inconnue reste dehors', () => {
  assert.equal(gpuPassBlockOf('WG DAG selection'), 'visibility');
  assert.equal(gpuPassBlockOf('WG visibility primary'), 'visibility');
  assert.equal(gpuPassBlockOf('WG HiZ pyramid'), 'visibility');
  assert.equal(gpuPassBlockOf('WG material surfaces v1'), 'materials');
  assert.equal(gpuPassBlockOf('WG empty surfaces'), 'materials');
  assert.equal(gpuPassBlockOf('WG deferred lighting'), 'other');
  assert.equal(gpuPassBlockOf('WG shadow atlas v1'), 'other');
  assert.equal(gpuPassBlockOf('WG opaque fallback'), 'other');
  assert.equal(gpuPassBlockOf('WG passe inventée demain'), 'other');
});

test('les durées d’un bloc s’additionnent, et la somme des trois vaut celle des passes', () => {
  const totals = gpuPassBlockTotals(
    sample([
      ['WG clear', 0.066],
      ['WG DAG selection', 0.406],
      ['WG visibility primary', 1.148],
      ['WG HiZ pyramid', 0.099],
      ['WG empty surfaces', 0.217],
      ['WG material surfaces v1', 2.084],
      ['WG deferred lighting', 1.5],
    ]),
  );
  assert.equal(totals.visibilityMs?.toFixed(3), '1.719');
  assert.equal(totals.materialsMs?.toFixed(3), '2.301');
  assert.equal(totals.otherMs, 1.5);
  assert.equal((totals.visibilityMs! + totals.materialsMs! + totals.otherMs!).toFixed(3), '5.520');
});

test('une passe sans durée annule SON bloc, jamais les autres', () => {
  const totals = gpuPassBlockTotals(
    sample([
      ['WG DAG selection', null],
      ['WG visibility primary', 1.148],
      ['WG material surfaces v1', 2.084],
    ]),
  );
  assert.equal(totals.visibilityMs, null, 'une somme partielle passerait pour une mesure');
  assert.equal(totals.materialsMs, 2.084);
  assert.equal(totals.otherMs, null, 'aucune passe : pas de bloc, et surtout pas un zéro');
});

test('l’ordre ne change rien : la passe sans durée annule son bloc même annoncée en dernier', () => {
  const totals = gpuPassBlockTotals(
    sample([
      ['WG visibility primary', 1.148],
      ['WG DAG selection', null],
    ]),
  );
  assert.equal(totals.visibilityMs, null);
});

test('un relevé tronqué ou absent ne donne aucun bloc', () => {
  const truncated = gpuPassBlockTotals(
    sample([['WG visibility primary', 1.148]], { truncated: true }),
  );
  assert.deepEqual(truncated, { visibilityMs: null, materialsMs: null, otherMs: null });
  assert.deepEqual(gpuPassBlockTotals(null), {
    visibilityMs: null,
    materialsMs: null,
    otherMs: null,
  });
  assert.deepEqual(gpuPassBlockTotals(undefined), {
    visibilityMs: null,
    materialsMs: null,
    otherMs: null,
  });
});
