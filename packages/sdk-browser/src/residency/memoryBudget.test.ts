// The effect chain's targets in the GPU total: reserved on the declared canvas
// by the rule the renderers count them with, before the pools, whose defaults stay what they were.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { effect } from '../../../sdk-core/src/world/effect/index.ts'
import { createWebgpuEffects } from '../webgpu/effects/webgpuEffects.ts'
import { effectChainBytesAt } from '../effects/targets.ts'
import { DEFAULT_GEOMETRY_POOL_BUDGET, DEFAULT_TEXTURE_POOL_BUDGET } from './pools.ts'
import {
  DEFAULT_BUDGET_CANVAS,
  DEFAULT_CPU_BUDGET,
  effectTargetExcess,
  splitMemoryBudget,
} from './memoryBudget.ts'
import { BOUNCE_PROBE_BYTES, SHADOW_POOL_BYTES } from './shadowBudgetBytes.ts'
import { DEFAULT_GPU_BUDGET, EFFECT_TARGET_BYTES } from './budget.fixture.ts'

const [width, height] = [3840, 2160]
const MiB = 1024 * 1024
const chain = [effect.bloom(), effect.bloom({ intensity: 0.5 })]

test('the default reserve is the target rule on a 3840 × 2160 canvas, the most a chain holds', async () => {
  assert.deepEqual(DEFAULT_BUDGET_CANVAS, { width, height })
  assert.equal(EFFECT_TARGET_BYTES, effectChainBytesAt(width, height))
  const gpu = fakeDevice()
  const webgpu = createWebgpuEffects(gpu.device, (error) => assert.fail(String(error)))
  const input = {} as GPUTextureView,
    encoder = {
      beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }),
    } as unknown as GPUCommandEncoder
  webgpu.encode(encoder, chain, input, width, height)
  await webgpu.settled()
  webgpu.encode(encoder, chain, input, width, height)
  assert.equal(webgpu.bytes, EFFECT_TARGET_BYTES, 'two pass targets, bloom levels')
})

test('the default GPU total grows by exactly that reserve, and each pool keeps 512 MiB', () => {
  const before = SHADOW_POOL_BYTES + BOUNCE_PROBE_BYTES + 1024 * MiB
  assert.equal(DEFAULT_GPU_BUDGET - before, effectChainBytesAt(width, height))
  assert.equal(DEFAULT_GEOMETRY_POOL_BUDGET, 512 * MiB)
  assert.equal(DEFAULT_TEXTURE_POOL_BUDGET, 512 * MiB)
})

test('a larger declared canvas reserves more, and a canvas past it is the excess', () => {
  const uhd = { width: 7680, height: 4320 }
  const reserve = effectChainBytesAt(7680, 4320)
  assert.equal(
    splitMemoryBudget(DEFAULT_GPU_BUDGET * 2, DEFAULT_CPU_BUDGET, uhd).effectTargets,
    reserve,
  )
  // The default total, not raised with it, leaves the pools what the larger reserve spares.
  const squeezed = splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET, uhd)
  assert.ok(squeezed.geometryPool < DEFAULT_GEOMETRY_POOL_BUDGET)
  assert.throws(
    () => splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET, { width: 0, height }),
    /INVALID_BUDGET_CANVAS/,
  )
  assert.equal(effectTargetExcess(7680, 4320, DEFAULT_BUDGET_CANVAS), reserve - EFFECT_TARGET_BYTES)
  assert.equal(effectTargetExcess(width, height, DEFAULT_BUDGET_CANVAS), 0)
  assert.equal(effectTargetExcess(1920, 1080, DEFAULT_BUDGET_CANVAS), 0)
  assert.equal(effectTargetExcess(7680, 4320, uhd), 0)
})

test('the split reserves the effect targets before the pools, whose defaults stay', () => {
  const shares = splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CPU_BUDGET)
  assert.equal(shares.effectTargets, EFFECT_TARGET_BYTES)
  assert.equal(shares.geometryPool, DEFAULT_GEOMETRY_POOL_BUDGET)
  assert.equal(shares.texturePool, DEFAULT_TEXTURE_POOL_BUDGET)
  const fixed = SHADOW_POOL_BYTES + BOUNCE_PROBE_BYTES + EFFECT_TARGET_BYTES
  assert.equal(
    DEFAULT_GPU_BUDGET,
    fixed + DEFAULT_GEOMETRY_POOL_BUDGET + DEFAULT_TEXTURE_POOL_BUDGET,
  )
  assert.throws(() => splitMemoryBudget(fixed - 1, DEFAULT_CPU_BUDGET), /UNDER_SHADOW_POOL/)
  const least = splitMemoryBudget(fixed + 2, DEFAULT_CPU_BUDGET)
  assert.ok(fixed + least.geometryPool + least.texturePool <= fixed + 2)
})
