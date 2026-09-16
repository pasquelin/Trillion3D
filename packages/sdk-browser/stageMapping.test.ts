import test from 'node:test';
import assert from 'node:assert/strict';
import { addGpuPasses, directLightTimings } from './stageMapping.ts';
import { SHADOW_PASS } from './gpuShadowAtlas.ts';
import { LIGHT_TILES_PASS } from './gpuLightTiles.ts';
import { DEFERRED_LIGHTING_PASS } from './deferredLighting.ts';
import type { GpuPassTimings } from '../sdk-core/index.ts';

function sample(passes: GpuPassTimings['passes'], truncated = false): GpuPassTimings {
  return { frame: 1, totalMs: null, truncated, passes };
}

function collect(s: GpuPassTimings | null | undefined) {
  const deposits: Array<[string, number]> = [];
  addGpuPasses(s, (stage, ms) => deposits.push([stage, ms]));
  return deposits;
}

test('deux passes de la même étape se somment en un seul dépôt', () => {
  const deposits = collect(
    sample([
      { name: 'WG DAG selection', gpuMs: 1 },
      { name: 'WG draw compaction', gpuMs: 2 },
    ]),
  );
  assert.deepEqual(deposits, [['selection', 3]]);
});

test('une passe à l’étiquette inconnue rejoint geometry', () => {
  const deposits = collect(sample([{ name: 'passe jamais vue', gpuMs: 5 }]));
  assert.deepEqual(deposits, [['geometry', 5]]);
});

test('une passe non mesurée invalide toute l’étape, jamais une somme partielle', () => {
  const dejaValide = collect(
    sample([
      { name: 'WG DAG selection', gpuMs: 1 },
      { name: 'WG draw compaction', gpuMs: null },
    ]),
  );
  assert.deepEqual(dejaValide, []);

  const dejaInvalide = collect(
    sample([
      { name: 'WG draw compaction', gpuMs: null },
      { name: 'WG DAG selection', gpuMs: 1 },
    ]),
  );
  assert.deepEqual(dejaInvalide, []);
});

test('un relevé tronqué ou absent ne dépose aucune étape', () => {
  assert.deepEqual(collect(sample([{ name: 'WG HiZ pyramid', gpuMs: 4 }], true)), []);
  assert.deepEqual(collect(null), []);
  assert.deepEqual(collect(undefined), []);
});

test('directLightTimings lit les trois durées par étiquette, null si la passe est absente', () => {
  const timings = directLightTimings(
    sample([
      { name: SHADOW_PASS, gpuMs: 2 },
      { name: LIGHT_TILES_PASS, gpuMs: 3 },
    ]),
  );
  assert.deepEqual(timings, { gpuLightListsMs: 3, gpuShadowsMs: 2, gpuLightingMs: null });
});

test('l’éclairage direct garde ses valeurs même quand une autre étape est invalidée', () => {
  const timings = directLightTimings(
    sample([
      { name: SHADOW_PASS, gpuMs: 2 },
      { name: LIGHT_TILES_PASS, gpuMs: 3 },
      { name: DEFERRED_LIGHTING_PASS, gpuMs: 4 },
      { name: 'WG visibility primary', gpuMs: null },
      { name: 'WG opaque fallback', gpuMs: 1 },
    ]),
  );
  assert.deepEqual(timings, { gpuLightListsMs: 3, gpuShadowsMs: 2, gpuLightingMs: 4 });
});

test('les trois passes des transparents se somment sur leur étape, jamais sur geometry', () => {
  const deposits = collect(
    sample([
      { name: 'WG transparents', gpuMs: 2 },
      { name: 'WG transmission', gpuMs: 3 },
      { name: 'WG transparent compaction', gpuMs: 1 },
    ]),
  );
  assert.deepEqual(deposits, [['transparents', 6]]);
});
