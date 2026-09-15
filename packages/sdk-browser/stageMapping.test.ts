import test from 'node:test';
import assert from 'node:assert/strict';
import { addGpuPasses, directLightTimings } from './stageMapping.ts';
import { SHADOW_PASS } from './gpuShadowAtlas.ts';
import { LIGHT_TILES_PASS } from './gpuLightTiles.ts';
import { DEFERRED_LIGHTING_PASS } from './deferredLighting.ts';
import type { GpuPassTimings } from '../sdk-core/index.ts';

type Pass = GpuPassTimings['passes'][number];
const pass = (name: string, gpuMs: number | null): Pass => ({ name, gpuMs });
const sample = (passes: Pass[], truncated = false): GpuPassTimings => ({
  frame: 1,
  totalMs: null,
  truncated,
  passes,
});

/** Les étapes que le relevé dépose, dans l'ordre où elles le sont. */
function collect(s: GpuPassTimings | null | undefined) {
  const deposits: Array<[string, number]> = [];
  addGpuPasses(s, (stage, ms) => deposits.push([stage, ms]));
  return deposits;
}

test('deux passes de la même étape se somment en un seul dépôt', () => {
  const deposits = collect(sample([pass('WG DAG selection', 1), pass('WG draw compaction', 2)]));
  assert.deepEqual(deposits, [['selection', 3]]);
});

test('une passe à l’étiquette inconnue rejoint geometry', () => {
  assert.deepEqual(collect(sample([pass('passe jamais vue', 5)])), [['geometry', 5]]);
});

test('une passe non mesurée invalide toute l’étape, jamais une somme partielle', () => {
  const mesuree = pass('WG DAG selection', 1),
    muette = pass('WG draw compaction', null);
  assert.deepEqual(collect(sample([mesuree, muette])), []);
  assert.deepEqual(collect(sample([muette, mesuree])), []);
});

test('un relevé tronqué ou absent ne dépose aucune étape', () => {
  assert.deepEqual(collect(sample([pass('WG HiZ pyramid', 4)], true)), []);
  assert.deepEqual(collect(null), []);
  assert.deepEqual(collect(undefined), []);
});

test('directLightTimings lit les trois durées par étiquette, null si la passe est absente', () => {
  const timings = directLightTimings(sample([pass(SHADOW_PASS, 2), pass(LIGHT_TILES_PASS, 3)]));
  assert.deepEqual(timings, { gpuLightListsMs: 3, gpuShadowsMs: 2, gpuLightingMs: null });
});

test('l’éclairage direct garde ses valeurs même quand une autre étape est invalidée', () => {
  const lumieres = [
    pass(SHADOW_PASS, 2),
    pass(LIGHT_TILES_PASS, 3),
    pass(DEFERRED_LIGHTING_PASS, 4),
  ];
  const timings = directLightTimings(sample([...lumieres, pass('WG visibility primary', null)]));
  assert.deepEqual(timings, { gpuLightListsMs: 3, gpuShadowsMs: 2, gpuLightingMs: 4 });
});
