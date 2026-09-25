// #349: the budget declares its largest canvas; the effect chain's targets are reserved at its
// size, and a canvas drawn past it renders whole while the diagnostics say the byte excess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { worldBudget, worldPools } from './worldBudget.ts';
import { noticeEffectBudget } from '../diagnostic/worldNotices.ts';
import { DEFAULT_GEOMETRY_POOL_BUDGET } from '../../residency/pools.ts';
import {
  DEFAULT_BUDGET_CANVAS,
  DEFAULT_GPU_BUDGET,
  EFFECT_TARGET_BYTES,
} from '../../residency/memoryBudget.ts';
import { effectChainBytesAt } from '../../effects/targets.ts';
import { createWebglEffects } from '../../effects/webglEffects.ts';
import { createTestContext } from '../../webgl/core/testContext.fixture.ts';
import { effect } from '../../../../sdk-core/src/world/effect/index.ts';
import { DEFAULT_PHYSICS_BUDGET } from '../../../../sdk-core/src/physics/index.ts';

const budget = (pools = worldPools()) =>
  worldBudget(pools, { explorer: null }, { last: null }, () => 'webgpu', {
    ...DEFAULT_PHYSICS_BUDGET,
  });
const uhd = { width: 7680, height: 4320 };

test('world.budget.canvas is 3840 × 2160 by default and sizes the effect reserve', () => {
  const handle = budget();
  assert.deepEqual(handle.canvas, DEFAULT_BUDGET_CANVAS);
  assert.equal(handle.split.effectTargets, EFFECT_TARGET_BYTES);
  // Declared larger, the default total grows by the reserve alone: the pools keep theirs.
  handle.canvas = uhd;
  assert.deepEqual(handle.canvas, uhd);
  assert.equal(handle.split.effectTargets, effectChainBytesAt(7680, 4320));
  assert.equal(
    handle.gpu,
    DEFAULT_GPU_BUDGET + effectChainBytesAt(7680, 4320) - EFFECT_TARGET_BYTES,
  );
  assert.equal(handle.geometryPool, DEFAULT_GEOMETRY_POOL_BUDGET);
});

test('under a GPU total set, a larger canvas redraws the pools; a bad one changes nothing', () => {
  const pools = worldPools();
  const handle = budget(pools);
  handle.gpu = DEFAULT_GPU_BUDGET;
  handle.canvas = uhd;
  assert.equal(handle.gpu, DEFAULT_GPU_BUDGET);
  assert.ok(pools.geometryPool! < DEFAULT_GEOMETRY_POOL_BUDGET, 'the larger reserve comes first');
  assert.throws(() => (handle.canvas = { width: 0, height: 1 }), /INVALID_BUDGET_CANVAS/);
  assert.deepEqual(handle.canvas, uhd);
});

test('a canvas past the declared one renders whole and says the byte excess once', () => {
  const said: { kind: string; message: string; context: Record<string, unknown> }[] = [];
  const notices = {
    say: (kind: string, message: string, context = {}) => said.push({ kind, message, context }),
  };
  const drawn = { width: 1920, height: 1080 },
    chain = { size: 1 };
  const frame = noticeEffectBudget({ canvas: DEFAULT_BUDGET_CANVAS }, drawn, chain, notices);
  frame();
  assert.equal(said.length, 0, 'within the declared canvas');
  Object.assign(drawn, uhd);
  frame();
  frame();
  const excess = effectChainBytesAt(7680, 4320) - EFFECT_TARGET_BYTES;
  assert.equal(said.length, 1, 'said when the excess grows, not every frame');
  assert.equal(said[0].kind, 'effect-targets-over-budget');
  assert.match(said[0].message, new RegExp(`^effect targets over budget: ${excess} bytes`));
  assert.equal(said[0].context.excess, excess);
  chain.size = 0;
  frame();
  assert.equal(said.length, 1, 'an empty chain holds no target');
  // The chain on that canvas holds its targets at the full image size: nothing is shrunk.
  const webgl = createWebglEffects(createTestContext().gl);
  webgl.begin([effect.bloom(), effect.bloom()], uhd.width, uhd.height);
  assert.equal(webgl.bytes, effectChainBytesAt(uhd.width, uhd.height));
});
