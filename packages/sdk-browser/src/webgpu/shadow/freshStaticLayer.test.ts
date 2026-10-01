// #831: a page the GPU draws itself keeps its still casters in the static layer too, as the reference engine
// renders a new page's static casters into its static cache. While a car drives and the camera
// follows, the pages it crosses are then restored from that layer: their static geometry is drawn
// once, when the page is first seen, never again for the mover (`mirrorKeepsGpuDraw.test.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_CULL_FLOATS } from '../../../../sdk-core/src/index.ts';
import { MOBILITY_CORNER_SHIFT, MOBILITY_MOVING } from '../../gpu/shadow/cullShader.ts';
import { FRESH_LAYER_PASS } from '../../gpu/shadow/staticLayer.ts';
import { SHADOW_FRESH_DRAWS_WGSL } from './freshDrawsWgsl.ts';
import { FRESH_ARG, FRESH_CASTERS, FRESH_CLEAR, FRESH_MOVING_PAIR } from './freshLayout.ts';
import { FRESH_PARAMS, freshArgWords, freshDrawWord } from './freshLayout.ts';
import { LAYERS, frame } from './freshPass.fixture.ts';
import { runShadowPairs } from './freshRun.fixture.ts';

test('each layer draws its new pages’ still casters into the static layer, after the pool', () => {
  const calls: unknown[][] = [],
    { lights, encode } = frame(calls);
  lights.staticLayer = { passes: [0, 1].map((layer) => ({ label: `static ${layer}` })) };
  encode();
  const passes = calls.filter((call) => call[0] === 'pass').map((call) => call[1]);
  assert.deepEqual(passes, ['layer 0', 'layer 1', FRESH_LAYER_PASS, FRESH_LAYER_PASS]);
  const starts = calls.flatMap((call, i) => (call[1] === FRESH_LAYER_PASS ? [i] : []));
  starts.forEach((at, layer) =>
    assert.deepEqual(calls.slice(at + 3, at + 8), [
      ['group', 2, 'pool group'],
      ['pipeline', 'clear'],
      ['draw', 'freshArgs', 4 * freshDrawWord(layer, FRESH_CLEAR)],
      ['pipeline', 'staticCasters'],
      ['draw', 'freshArgs', 4 * freshDrawWord(layer, FRESH_CASTERS)],
    ]),
  );
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

test('a moving row’s pair is tagged, and the static layer’s draw leaves it out', () => {
  // One region, a box two metres wide, and two rows inside it: a still one, then a moving one.
  const volume = new Float32Array(SHADOW_CULL_FLOATS);
  volume.set([0, 0, 0, 1, 0, 0, 1, -1, 1, 0, 0, 1, 0, 1, 0, 1]);
  const spheres = new Float32Array([0, 0, 0, 0.5, 0.5, 0, 0, 0.5]),
    corners = 3 << MOBILITY_CORNER_SHIFT,
    mobility = Uint32Array.of(corners, corners | MOBILITY_MOVING),
    params = new Uint32Array(FRESH_PARAMS),
    args = new Uint32Array(freshArgWords(4)),
    pairs = new Uint32Array(8);
  params.set([4, 2, 1, 2, 2, 2, 4]);
  args[FRESH_ARG.regions] = 1;
  runShadowPairs(
    ...[spheres, params, volume, pairs, args, mobility].map((a) => new Uint8Array(a.buffer)),
  );
  const kept = new Map([0, 1].map((i) => [pairs[2 * i + 1], pairs[2 * i]]));
  assert.equal(kept.get(0), 0, 'the still row: its region alone');
  assert.equal(kept.get(1), FRESH_MOVING_PAIR, 'the moving row: its region, tagged');
  assert.ok(SHADOW_FRESH_DRAWS_WGSL.includes('let k=word&2147483647u;'));
  assert.ok(SHADOW_FRESH_DRAWS_WGSL.includes('||(still&&word!=k)'));
  assert.ok(
    SHADOW_FRESH_DRAWS_WGSL.includes('return freshCaster(vertexIndex,instanceIndex,false,true);'),
  );
});
