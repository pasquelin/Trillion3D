// Per-kind dispatch (#349): each renderer runs a pass through the one table entry of its kind,
// which receives the pass itself and its rank among the passes of that kind — the place where the
// other built-ins and the custom pass plug in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { effect } from '../../../sdk-core/src/world/effect/index.ts';
import type { Bloom } from '../../../sdk-core/src/world/effect/bloom.ts';
import { createTestContext } from '../webgl/core/testContext.fixture.ts';
import { EFFECT_KIND_BYTES } from './targets.ts';
import { createWebglEffects, WEBGL_KINDS } from './webglEffects.ts';
import { createWebgpuEffects, WEBGPU_KINDS } from './webgpuEffects.ts';

/** A kind that records what it is asked: sizes, and each pass with its rank. */
function spy() {
  const drawn: [Bloom, number][] = [],
    sized: number[][] = [];
  const kind = {
    bytes: 0,
    resize: (w: number, h: number, count: number) => void sized.push([w, h, count]),
    dispose() {},
  };
  const draw = (pass: Bloom, nth: number) => (drawn.push([pass, nth]), 1);
  return {
    drawn,
    sized,
    webgl: { ...kind, draw },
    webgpu: { ...kind, encode: (...args: unknown[]) => draw(args[1] as Bloom, args[2] as number) },
  };
}

const chain = [effect.bloom(), effect.bloom({ intensity: 0.5 })];

test('both renderers have one implementation per kind, the kinds the budget reserves', () => {
  const kinds = Object.keys(EFFECT_KIND_BYTES).sort();
  assert.deepEqual(Object.keys(WEBGL_KINDS).sort(), kinds);
  assert.deepEqual(Object.keys(WEBGPU_KINDS).sort(), kinds);
});

test('WebGL2 hands each pass to its kind, with its rank among that kind', (t) => {
  const kind = spy(),
    made = WEBGL_KINDS.bloom;
  t.after(() => void (WEBGL_KINDS.bloom = made));
  WEBGL_KINDS.bloom = () => kind.webgl;
  const effects = createWebglEffects(createTestContext().gl);
  effects.begin(chain, 8, 4);
  effects.end(chain, null, { toneMapped: true, toneCurve: 0, background: [0, 0, 0] });
  assert.deepEqual(kind.sized, [[8, 4, 2]], 'sized once for its two passes');
  assert.deepEqual(kind.drawn, [
    [chain[0], 0],
    [chain[1], 1],
  ]);
});

test('WebGPU hands each pass to its kind, with its rank among that kind', async (t) => {
  const kind = spy(),
    made = WEBGPU_KINDS.bloom;
  t.after(() => void (WEBGPU_KINDS.bloom = made));
  WEBGPU_KINDS.bloom = async () => kind.webgpu;
  const effects = createWebgpuEffects(fakeDevice().device, (error) => assert.fail(String(error)));
  const encoder = {} as GPUCommandEncoder,
    input = {} as GPUTextureView;
  effects.encode(encoder, chain, input, 8, 4);
  while (effects.loading) await new Promise((resolve) => setImmediate(resolve));
  effects.encode(encoder, chain, input, 8, 4);
  assert.deepEqual(kind.drawn, [
    [chain[0], 0],
    [chain[1], 1],
  ]);
  assert.deepEqual(kind.sized.at(-1), [8, 4, 2]);
});
