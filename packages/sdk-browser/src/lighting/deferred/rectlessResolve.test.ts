// #1369: a scene that holds no rectangle light is resolved by a program with no rectangle code in
// its light loop — the largest code of the loop, whose registers every punctual light paid for —,
// and a scene that holds one never is. `isRect` answers false for every light of such a scene, so
// the branches left out never ran: the program is the full one less those two branches, character
// for character. That both give the same sums, bit for bit, runs on the GPU:
// `tests/browser/probes/narrow-resolve-gpu.ts` and `sampled-resolve-gpu.ts`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contractLightingShader } from './shaders.ts';
import { createDeferredLighting } from './deferred.ts';
import { recorder } from './recorder.fixture.ts';
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts';

/** The two rectangle branches of the light loop: its term, then its sampling weight. */
const RECT_TERM = /\n if\(isRect\(light\)\)\{\n[\s\S]*?\n \}/;
const RECT_WEIGHT = /\n if\(isRect\(light\)\)\{return [^\n]*\}/;

test('the rectless program is the full one less its two rectangle branches', () => {
  for (const [bounce, narrow, shadowed] of [
    [false, false, true],
    [true, true, true],
    [false, false, false],
  ] as const) {
    const full = contractLightingShader(bounce, narrow, undefined, shadowed);
    const rectless = contractLightingShader(bounce, narrow, undefined, shadowed, false);
    assert.match(full, RECT_TERM);
    assert.match(full, RECT_WEIGHT);
    assert.equal(full.replace(RECT_TERM, '').replace(RECT_WEIGHT, ''), rectless);
    // No other call reaches the rectangle's shading from the loop.
    const loop = rectless.slice(rectless.indexOf('fn declaredLight('));
    assert.doesNotMatch(loop.split('\n}')[0], /rectLight\(|rectIrradiance\(/);
  }
});

test('a scene with no rectangle is lit by the rectless program, one with a rectangle never is', async () => {
  const { device } = fakeDevice();
  const lighting = await createDeferredLighting(device);
  const { labels, draw } = recorder(lighting);
  const frame = (rectless: boolean) => draw({ rectless });
  frame(true);
  await lighting.settle();
  // The twin with rectangle code compiled beside it: a rectangle added is lit at once.
  frame(true);
  frame(false);
  frame(true);
  assert.deepEqual(labels, [
    'DIRECT_RECTLESS_LIGHTING',
    'DIRECT_LIGHTING',
    'DIRECT_RECTLESS_LIGHTING',
  ]);
  lighting.dispose();
});
