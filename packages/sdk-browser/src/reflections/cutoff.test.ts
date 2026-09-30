// #1341: screen reflections are traced only under Unreal's maximum roughness; past it, and wherever
// a trace holds nothing, the environment/probe reflection is read, never black.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import {
  createScreenReflection,
  wantsReflectionCone,
  wantsReflections,
  wantsRoughReflectionHistory,
} from './gpu.ts';
import { HELD_REFLECTION_WGSL, SCREEN_REFLECTION_WGSL } from './screenWgsl.ts';
import { SCREEN_REFLECTION_MAX_ROUGHNESS } from './modelShader.ts';
import { DEFERRED_LIGHTING_PASS } from '../lighting/deferred/deferred.ts';
import { contractLighting } from '../lighting/deferred/contractLighting.fixture.ts';
import { REFLECTION_SOURCE_PASS } from './encode.ts';
import { createWebgpuRowState } from '../webgpu/row/state.ts';
import type { PageRec } from '../page/selection/selection.ts';
import type { PageSurface } from '../page/surface.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

const CUTOFF = Number(SCREEN_REFLECTION_MAX_ROUGHNESS);
const physical = (roughness: number) => ({ lit: true, model: 0, roughness }) as PageSurface;

function scene(opaque: PageSurface[], forward: PageSurface[]) {
  const rows = createWebgpuRowState([], opaque.length);
  rows.packedCount = opaque.length;
  rows.packedRecs.splice(0, opaque.length, ...opaque.map((material) => ({ material }) as PageRec));
  return {
    run: { diagnostic: 'beauty' },
    layout: { rows },
    blendState: { blendGpu: forward.map((surface) => ({ surface })) },
  } as unknown as WebgpuPagesRuntime;
}

test('a matte-only scene allocates no reflection target and runs no reflection pass', async () => {
  const { lighting, labels, encoder, view } = await contractLighting();
  // A fully rough floor, a paint at the cutoff and a rough forward receiver: all matte. A mirror
  // beside them is what brings the reflection back.
  for (const [surfaces, reflecting] of [
    [[physical(1), physical(CUTOFF)], false],
    [[physical(1), physical(0)], true],
  ] as const) {
    const rt = scene([...surfaces], [physical(0.8)]);
    const gpu = fakeDevice();
    const reflection = createScreenReflection(
      gpu.device,
      64,
      32,
      view,
      wantsReflections(rt),
      wantsRoughReflectionHistory(rt),
      wantsReflectionCone(rt),
    );
    assert.equal(reflection.active, reflecting);
    // An inactive reflection keeps only its 1×1 binding placeholder: no target, no history.
    const sizes = gpu.textures.map(({ size }) => size);
    assert.deepEqual(sizes, [reflecting ? { width: 64, height: 32 } : { width: 1, height: 1 }]);
    assert.equal(reflection.history, undefined);
    assert.equal(reflection.pyramid, undefined);
    labels.length = 0;
    lighting.light(encoder, view, reflection);
    const passes = [DEFERRED_LIGHTING_PASS];
    assert.deepEqual(labels, reflecting ? [REFLECTION_SOURCE_PASS, ...passes] : passes);
    reflection.dispose();
  }
  lighting.dispose();
});

const ENVIRONMENT = [3, 3, 3],
  RAY = [7, 7, 7],
  FILTERED = [5, 5, 5];

function display(enabled = 1) {
  const traced = { calls: 0 };
  const { resolvedRadiance } = shaderRun<{
    resolvedRadiance: (P: number[], N: number[], R: number[], rough: number) => number[];
  }>(SCREEN_REFLECTION_WGSL, ['screenReflectionFade', 'tracedRadiance', 'resolvedRadiance'], {
    reflectionView: { enabled: [enabled, 0, 0, 0] },
    mix: (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t),
    mirrorWeight: (rough: number) => (rough <= 0.0525 ? 1 : 0),
    resolvedReflectionRay: () => (traced.calls++, RAY),
    filteredResolvedReflection: () => (traced.calls++, FILTERED),
    reflectedRadiance: () => ENVIRONMENT,
  });
  return {
    traced,
    at: (rough: number) => resolvedRadiance([0, 0, 0], [0, 1, 0], [0, 1, 0], rough),
  };
}

test('a surface rougher than the cutoff takes the environment reflection, a polished one the screen trace', () => {
  const { traced, at } = display();
  assert.deepEqual(at(0), RAY, 'a mirror keeps its exact ray');
  assert.deepEqual(at(0.2), FILTERED, 'polished metal keeps its screen trace');
  assert.equal(traced.calls, 2);
  assert.deepEqual(
    at(CUTOFF / 2 + CUTOFF / 4),
    [4, 4, 4],
    'the fade blends toward the environment',
  );
  traced.calls = 0;
  for (const rough of [CUTOFF, 0.8, 1]) assert.deepEqual(at(rough), ENVIRONMENT, `rough ${rough}`);
  assert.equal(traced.calls, 0, 'no trace past the cutoff');
  assert.deepEqual(display(0).at(0.2), ENVIRONMENT, 'no reflection pass, the environment alone');
});

test('a missed or below-horizon sample returns the environment reflection, not black', () => {
  // A missed ray: the screen trace finds no depth crossing.
  const { resolvedReflectionRay } = shaderRun<{
    resolvedReflectionRay: (P: number[], N: number[], R: number[]) => number[];
  }>(SCREEN_REFLECTION_WGSL, ['resolvedReflectionRay'], {
    screenReflection: () => [0, 0, 0, 0],
    reflectedRadiance: () => ENVIRONMENT,
  });
  assert.deepEqual(resolvedReflectionRay([0, 0, 0], [0, 1, 0], [0, 1, 0]), ENVIRONMENT);
  // Below-horizon samples carry no weight: a history that drew only those holds none.
  let held = [0, 0, 0, 0];
  const { heldReflection } = shaderRun<{
    heldReflection: (P: number[], N: number[], R: number[], rough: number) => number[];
  }>(HELD_REFLECTION_WGSL, ['heldReflection'], {
    roughHistory: 'history',
    reflectionProject: () => [0, 0, 0, 1],
    reflectionSize: () => [8, 8],
    textureLoad: () => held,
    reflectedRadiance: () => ENVIRONMENT,
  });
  const read = () => heldReflection([0, 0, 0], [0, 1, 0], [0, 1, 0], 0.3);
  assert.deepEqual(read(), ENVIRONMENT);
  held = [9, 9, 9, 2];
  assert.deepEqual(read(), [9, 9, 9], 'a weighted mean is the reflection');
});
