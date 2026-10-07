// Per-kind dispatch (#349): the renderer runs a pass through the one table entry of its kind,
// which receives the pass itself and its rank among the passes of that kind — the place where the
// other built-ins and the custom pass plug in.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { effect } from '../../../sdk-core/src/world/effect/index.ts'
import type { Bloom } from '../../../sdk-core/src/world/effect/bloom.ts'
import { createWebgpuEffects } from '../webgpu/effects/webgpuEffects.ts'
import { WEBGPU_KINDS } from '../webgpu/effects/webgpuKinds.ts'
import { EFFECT_KIND_BYTES } from './kindBytes.ts'

/** A kind that records what it is asked: sizes, and each pass with its rank. */
function spy() {
  const drawn: [Bloom, number][] = [],
    sized: number[][] = []
  const kind = {
    bytes: 0,
    resize: (w: number, h: number, count: number) => void sized.push([w, h, count]),
    dispose() {},
  }
  const draw = (pass: Bloom, nth: number) => (drawn.push([pass, nth]), 1)
  return {
    drawn,
    sized,
    webgpu: { ...kind, encode: (...args: unknown[]) => draw(args[1] as Bloom, args[2] as number) },
  }
}

const chain = [effect.bloom(), effect.bloom({ intensity: 0.5 })]

test('the renderer has one implementation per kind, the kinds the budget reserves', () => {
  assert.deepEqual(Object.keys(WEBGPU_KINDS).sort(), Object.keys(EFFECT_KIND_BYTES).sort())
})

test('the renderer hands each pass to its kind, with its rank among that kind', async (t) => {
  const kind = spy(),
    made = WEBGPU_KINDS.bloom
  t.after(() => void (WEBGPU_KINDS.bloom = made))
  WEBGPU_KINDS.bloom = async () => kind.webgpu
  const effects = createWebgpuEffects(fakeDevice().device, (error) => assert.fail(String(error)))
  const encoder = {} as GPUCommandEncoder,
    input = {} as GPUTextureView
  effects.encode(encoder, chain, input, 8, 4)
  await effects.settled()
  effects.encode(encoder, chain, input, 8, 4)
  assert.deepEqual(kind.drawn, [
    [chain[0], 0],
    [chain[1], 1],
  ])
  assert.deepEqual(kind.sized.at(-1), [8, 4, 2])
})
