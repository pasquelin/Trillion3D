import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addGpuPasses,
  directLightTimings,
  GPU_PASS_LABELS,
  gpuPassStageOf,
  gpuShadowPartOf,
  shadowPagesGpuMs,
} from './mapping.ts';
import { LIGHT_CUT_PASS } from '../gpu/dag/encode.ts';
import { SHADOW_PASS } from '../gpu/shadow/atlas.ts';
import { SHADOW_LAYER_PASS } from '../gpu/shadow/staticLayer.ts';
import { LIGHT_TILES_PASS } from '../lighting/tiles/tiles.ts';
import { DEFERRED_LIGHTING_PASS } from '../lighting/deferred/deferred.ts';
import type { GpuPassTimings } from '../../../sdk-core/src/index.ts';
import { referenceDirectLightTimings } from '../../../../bench/oracles/browser/stage-profile.ts';

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
  assert.deepEqual(timings, {
    gpuLightListsMs: 3,
    gpuShadowsMs: 2,
    gpuShadowCullMs: null,
    gpuShadowRasterMs: 2,
    gpuLightingMs: null,
  });
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
  assert.deepEqual(timings, {
    gpuLightListsMs: 3,
    gpuShadowsMs: 2,
    gpuShadowCullMs: null,
    gpuShadowRasterMs: 2,
    gpuLightingMs: 4,
  });
});

test('shadow time splits into choosing the casters and drawing them, from the same sample', () => {
  const timings = directLightTimings(
    sample([
      { name: LIGHT_CUT_PASS, gpuMs: 1 },
      { name: 'Trillion3D shadow cull', gpuMs: 0.5 },
      { name: 'Trillion3D shadow page pyramids', gpuMs: 0.25 },
      { name: 'Trillion3D shadow occlusion', gpuMs: 0.25 },
      { name: SHADOW_LAYER_PASS, gpuMs: 3 },
      { name: SHADOW_PASS, gpuMs: 4 },
      { name: DEFERRED_LIGHTING_PASS, gpuMs: 5 },
    ]),
  );
  assert.equal(timings.gpuShadowCullMs, 2);
  assert.equal(timings.gpuShadowRasterMs, 7);
  // The light cut is its own stage: the Shadows stage keeps its meaning.
  assert.equal(timings.gpuShadowsMs, 8);
  const unmeasured = directLightTimings(
    sample([
      { name: 'Trillion3D shadow cull', gpuMs: null },
      { name: SHADOW_PASS, gpuMs: 4 },
    ]),
  );
  assert.equal(unmeasured.gpuShadowCullMs, null, 'an unmeasured pass voids its part');
  assert.equal(unmeasured.gpuShadowRasterMs, 4);
});

// One table names every pass: a shadow row without its part would drop out of the split silently.
test('every pass of a shadow stage names its shadow part, and no other pass does', () => {
  const shadowStages = new Set(['shadows', 'shadowCasters']);
  for (const label of GPU_PASS_LABELS)
    assert.equal(
      gpuShadowPartOf(label) !== 'other',
      shadowStages.has(gpuPassStageOf(label)),
      label,
    );
  assert.equal(gpuShadowPartOf('never-seen pass'), 'other');
});

test('the bench reference reads the same shadow split as the engine', () => {
  const s = sample([
    { name: LIGHT_CUT_PASS, gpuMs: 1 },
    { name: 'Trillion3D shadow cull', gpuMs: 0.5 },
    { name: 'Trillion3D shadow page pyramids', gpuMs: 0.25 },
    { name: 'Trillion3D shadow occlusion', gpuMs: 0.25 },
    { name: SHADOW_LAYER_PASS, gpuMs: 3 },
    { name: SHADOW_PASS, gpuMs: 4 },
    { name: LIGHT_TILES_PASS, gpuMs: 2 },
    { name: DEFERRED_LIGHTING_PASS, gpuMs: 5 },
  ]);
  assert.deepEqual(referenceDirectLightTimings(s), directLightTimings(s));
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

// The light cuts run for the pages a frame draws: the shadow budget pays for them too.
test("the shadow budget's duration holds the pages' draw and their light cuts", () => {
  const drawn = { name: SHADOW_PASS, gpuMs: 0.5 },
    cut = { name: LIGHT_CUT_PASS, gpuMs: 0.25 };
  assert.equal(shadowPagesGpuMs(sample([drawn, cut])), 0.75);
  assert.equal(shadowPagesGpuMs(sample([drawn])), 0.5);
  assert.equal(shadowPagesGpuMs(sample([drawn, { ...cut, gpuMs: null }])), null);
  assert.equal(shadowPagesGpuMs(sample([])), null);
});
