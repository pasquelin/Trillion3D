// #831: a page the GPU draws itself keeps its still casters in the static layer, as Unreal renders
// a new page's static casters into its static cache and merges them under the dynamic ones: the
// still casters into the layer, then the pool's page restored from it, the moving casters alone
// over it. While a car drives and the camera follows, the pages it crosses are restored from that
// layer too: their still geometry is drawn once, when first seen (`mirrorKeepsGpuDraw.test.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { MOBILITY_CORNER_SHIFT, MOBILITY_MOVING } from '../../gpu/shadow/cullShader.ts';
import { FRESH_LAYER_PASS } from '../../gpu/shadow/staticLayer.ts';
import { SHADOW_FRESH_DRAWS_WGSL } from './freshDrawsWgsl.ts';
import { FRESH_ARG, FRESH_CLEAR, FRESH_MOVING, FRESH_STILL } from './freshLayout.ts';
import { FRESH_PARAMS, freshArgWords, freshDrawWord } from './freshLayout.ts';
import { FRESH_LAYOUT_WGSL } from './freshLayoutWgsl.ts';
import { LAYERS, frame } from './freshPass.fixture.ts';
import { runShadowPairs } from './freshRun.fixture.ts';
import { wgslConstants } from '../../texture/shaderRule.fixture.ts';
import { shaderRun } from '../../texture/shaderRun.fixture.ts';

test('each layer draws its new pages’ still casters into the static layer, then restores the pool from it under the moving ones', () => {
  const calls: unknown[][] = [],
    { lights, encode } = frame(calls);
  const layerGroups = ['static group 0', 'static group 1'];
  const freshPasses = layerGroups.map(() => ({ label: FRESH_LAYER_PASS }));
  lights.staticLayer = { passes: [{}, {}], freshPasses, groups: layerGroups };
  encode();
  const passes = calls.filter((call) => call[0] === 'pass').map((call) => call[1]);
  assert.deepEqual(passes, [FRESH_LAYER_PASS, 'layer 0', FRESH_LAYER_PASS, 'layer 1']);
  for (let layer = 0; layer < LAYERS; layer++) {
    const into = calls.findIndex((call) => call[1] === `layer ${layer}`),
      first = into - 9;
    assert.deepEqual(calls.slice(first + 3, first + 8), [
      ['group', 2, 'pool group'],
      ['pipeline', 'clear'],
      ['draw', 'freshArgs', 4 * freshDrawWord(layer, FRESH_CLEAR)],
      ['pipeline', 'staticCasters'],
      ['draw', 'freshArgs', 4 * freshDrawWord(layer, FRESH_STILL)],
    ]);
    assert.deepEqual(calls.slice(into + 3, into + 9), [
      ['group', 2, 'pool group'],
      ['group', 3, layerGroups[layer]],
      ['pipeline', 'restore'],
      ['draw', 'freshArgs', 4 * freshDrawWord(layer, FRESH_CLEAR)],
      ['pipeline', 'movingCasters'],
      ['draw', 'freshArgs', 4 * freshDrawWord(layer, FRESH_MOVING)],
    ]);
  }
  assert.equal(lights.plan.gpu.layered, true, 'the host adopts its pages with their layer');
  assert.equal(lights.shadowRenderPasses, 2 * LAYERS);
});

test('without a static layer the GPU pages draw the pool alone, and say so', () => {
  const calls: unknown[][] = [],
    { lights, encode } = frame(calls);
  encode();
  assert.ok(!calls.some((call) => call[1] === FRESH_LAYER_PASS));
  assert.equal(lights.plan.gpu.layered, false);
});

test('the still rows’ pairs lie from the list’s start, the moving ones’ from its end: each draw walks its own', () => {
  // One region, a box two metres wide, and three rows inside it: still, moving, still.
  const volume = new Float32Array(SHADOW_CULL_FLOATS);
  volume.set([0, 0, 0, 1, 0, 0, 1, -1, 1, 0, 0, 1, 0, 1, 0, 1]);
  volume[18] = 1;
  const spheres = new Float32Array([0, 0, 0, 0.5, 0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5]),
    corners = 3 << MOBILITY_CORNER_SHIFT,
    mobility = Uint32Array.of(corners, corners | MOBILITY_MOVING, corners),
    params = new Uint32Array(FRESH_PARAMS),
    args = new Uint32Array(freshArgWords(4)),
    pairs = new Uint32Array(16);
  params.set([4, 2, 1, 3, 3, 3, 8]);
  args[FRESH_ARG.regions] = 1;
  runShadowPairs(
    ...[spheres, params, volume, pairs, args, mobility].map((a) => new Uint8Array(a.buffer)),
  );
  const rowAt = (place: number) => pairs[2 * place + 1];
  assert.deepEqual([args[FRESH_ARG.still], args[FRESH_ARG.moving]], [2, 1]);
  assert.deepEqual([rowAt(0), rowAt(1)].sort(), [0, 2], 'the still rows from the start');
  assert.equal(rowAt(7), 1, 'the moving row at the last place');
  // The draws' instances (`freshPairAt`), once the compose wrote the last place.
  args[FRESH_ARG.last] = 7;
  const text = FRESH_LAYOUT_WGSL + SHADOW_FRESH_DRAWS_WGSL,
    constants = wgslConstants(text);
  const { freshPairAt } = shaderRun<{ freshPairAt: (i: number, keep: number) => number }>(
    text,
    ['freshPairAt'],
    { ...constants, freshArgs: args },
  );
  const walk = (keep: number, count: number) =>
    Array.from({ length: count }, (_, i) => rowAt(freshPairAt(i, keep)));
  assert.deepEqual(walk(constants.FRESH_STILL, 2).sort(), [0, 2], 'the static layer: the still');
  assert.deepEqual(walk(constants.FRESH_MOVING, 1), [1], 'the pool over it: the moving alone');
  assert.deepEqual(walk(constants.FRESH_ALL, 3).sort(), [0, 1, 2], 'every kept caster, once');
});
