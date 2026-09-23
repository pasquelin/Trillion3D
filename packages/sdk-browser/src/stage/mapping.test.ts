import test from 'node:test';
import assert from 'node:assert/strict';
import { addGpuPasses, directLightTimings } from './mapping.ts';
import { SHADOW_PASS } from '../gpu/shadow/atlas.ts';
import { LIGHT_TILES_PASS } from '../lighting/tiles/tiles.ts';
import { DEFERRED_LIGHTING_PASS } from '../lighting/deferred/deferred.ts';
import type { GpuPassTimings } from '../../../sdk-core/src/index.ts';

function sample(passes: GpuPassTimings['passes'], truncated = false): GpuPassTimings {
  return { frame: 1, totalMs: null, truncated, passes };
}

function collect(s: GpuPassTimings | null | undefined) {
  const deposits: Array<[string, number]> = [];
  addGpuPasses(s, (stage, ms) => deposits.push([stage, ms]));
  return deposits;
}

test('two passes of the same stage sum into one deposit', () => {
  const deposits = collect(
    sample([
      { name: 'Trillion3D DAG selection', gpuMs: 1 },
      { name: 'Trillion3D draw compaction', gpuMs: 2 },
    ]),
  );
  assert.deepEqual(deposits, [['selection', 3]]);
});

test('a pass with an unknown label joins geometry', () => {
  const deposits = collect(sample([{ name: 'never-seen pass', gpuMs: 5 }]));
  assert.deepEqual(deposits, [['geometry', 5]]);
});

test('an unmeasured pass invalidates the whole stage, never a partial sum', () => {
  const dejaValide = collect(
    sample([
      { name: 'Trillion3D DAG selection', gpuMs: 1 },
      { name: 'Trillion3D draw compaction', gpuMs: null },
    ]),
  );
  assert.deepEqual(dejaValide, []);

  const dejaInvalide = collect(
    sample([
      { name: 'Trillion3D draw compaction', gpuMs: null },
      { name: 'Trillion3D DAG selection', gpuMs: 1 },
    ]),
  );
  assert.deepEqual(dejaInvalide, []);
});

test('a truncated or missing sample deposits no stage', () => {
  assert.deepEqual(collect(sample([{ name: 'Trillion3D HiZ pyramid', gpuMs: 4 }], true)), []);
  assert.deepEqual(collect(null), []);
  assert.deepEqual(collect(undefined), []);
});

test('directLightTimings reads the three durations by label, null if the pass is absent', () => {
  const timings = directLightTimings(
    sample([
      { name: SHADOW_PASS, gpuMs: 2 },
      { name: LIGHT_TILES_PASS, gpuMs: 3 },
    ]),
  );
  assert.deepEqual(timings, { gpuLightListsMs: 3, gpuShadowsMs: 2, gpuLightingMs: null });
});

test('direct lighting keeps its values even when another stage is invalidated', () => {
  const timings = directLightTimings(
    sample([
      { name: SHADOW_PASS, gpuMs: 2 },
      { name: LIGHT_TILES_PASS, gpuMs: 3 },
      { name: DEFERRED_LIGHTING_PASS, gpuMs: 4 },
      { name: 'Trillion3D visibility primary', gpuMs: null },
      { name: 'Trillion3D opaque fallback', gpuMs: 1 },
    ]),
  );
  assert.deepEqual(timings, { gpuLightListsMs: 3, gpuShadowsMs: 2, gpuLightingMs: 4 });
});

test('the three transparent passes sum onto their stage, never onto geometry', () => {
  const deposits = collect(
    sample([
      { name: 'Trillion3D transparents', gpuMs: 2 },
      { name: 'Trillion3D transmission', gpuMs: 3 },
      { name: 'Trillion3D transparent compaction', gpuMs: 1 },
    ]),
  );
  assert.deepEqual(deposits, [['transparents', 6]]);
});
