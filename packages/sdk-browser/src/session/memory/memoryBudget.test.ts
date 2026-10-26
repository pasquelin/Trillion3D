import { DEFAULT_CACHED_BYTES } from '../../geometry/streaming/pageCache.ts'
// The effect chain's and the display finishing's targets in the GPU total: reserved on the declared
// canvas by the rule the renderers count them with, before the pools, whose defaults stay what
// they were.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { createWebgpuEffects } from '../../post/effects/webgpuEffects.ts'
import { effectChainBytesAt } from '../../post/effects/targets.ts'
import {
  DEFAULT_GEOMETRY_POOL_BUDGET,
  DEFAULT_TEXTURE_POOL_BUDGET,
} from '../../../../sdk-core/src/contracts/poolBudgets.ts'
import { DEFAULT_BUDGET_CANVAS, effectTargetExcess, splitMemoryBudget } from './memoryBudget.ts'
import { BOUNCE_PROBE_BYTES, SHADOW_POOL_BYTES } from './shadowBudgetBytes.ts'
import { DEFAULT_GPU_BUDGET, EFFECT_TARGET_BYTES } from './budget.fixture.ts'
import { MIB } from '../../../../math/src/constants.ts'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { OverlayFrame } from '../../post/effects/webgpuKinds.ts'
import { createFinish } from '../../post/finish/finish.ts'
import { lensOf } from '../../post/finish/finishParams.ts'
import { createWorldEffects } from '../../../../sdk-core/src/world/effect/defaultChain.ts'
import { createKindSettings } from '../../post/effects/kindSettings.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { frameOf } from '../../post/effects/webgpuEffects.fixture.ts'

const [width, height] = [3840, 2160]
// Three blooms: the last one's glow is the composition's, the two before it fill both pass
// targets; a threshold makes the first draw a setup and a chain of its own, the most a bloom
// holds, which the blooms of a chain share.
const chain = [
  effect.bloom({ threshold: 1 }),
  effect.bloom({ intensity: 0.5 }),
  effect.bloom({ intensity: 0.25 }),
]

test('the default reserve is the target rule on a 3840 × 2160 canvas, the most a chain holds', async () => {
  assert.deepEqual(DEFAULT_BUDGET_CANVAS, { width, height })
  assert.equal(EFFECT_TARGET_BYTES, effectChainBytesAt(width, height))
  const gpu = fakeDevice()
  const webgpu = createWebgpuEffects(gpu.device, (error) => assert.fail(String(error)))
  const input = {} as GPUTextureView,
    encoder = gpu.device.createCommandEncoder()
  const finish = createFinish(gpu.device)
  const framed = () => {
    finish.scene.begin(encoder, input, width, height)
    // The grain's texture too, which the finishing makes where the grain is drawn.
    const layers = finish.groupFor(false, undefined, true)
    return {
      scene: finish.scene,
      bare: finish.bare,
      layers,
      local: false,
      uniform: finish.uniform,
      lens: lensOf(null),
    }
  }
  webgpu.encode(encoder, chain, input, width, height, framed())
  await webgpu.settled()
  webgpu.encode(encoder, chain, input, width, height, framed())
  // The local exposure's grid, log luminance and blur, over the scene's half-size image.
  finish.local.encode(
    encoder,
    finish.scene,
    50,
    true,
    createKindSettings().peek('bloom', undefined),
  )
  // The motion blur on the resolved image, ahead of the chain: its image, its motion and its tiles.
  const blur = [effect.motionBlur()]
  webgpu.stage('after-resolve').ready(blur)
  await webgpu.settled()
  webgpu.stage('after-resolve').resolve(encoder, blur, input, frameOf(gpu, width, height))
  // An outline of an object, drawn over the display image: its scan's target.
  const outline = [effect.outline({ objects: [new Object3D()] })]
  const frame = {
    size: [width, height],
    layout: { selectionRoots: [], rootIndex: { revision: 0 } },
    revisions: { scene: 1, view: 1, resources: 1 },
  } as unknown as OverlayFrame
  webgpu.overlay(encoder, outline, frame)
  await webgpu.settled()
  webgpu.overlay(encoder, outline, frame)
  assert.equal(
    webgpu.bytes + finish.bytes,
    EFFECT_TARGET_BYTES,
    'two pass targets, the blur’s, the blooms’ images, outline scan, the finishing’s chain and layers',
  )
})

test('the default GPU total grows by exactly that reserve, and each pool keeps 512 MiB', () => {
  const before = SHADOW_POOL_BYTES + BOUNCE_PROBE_BYTES + 1024 * MIB
  assert.equal(DEFAULT_GPU_BUDGET - before, effectChainBytesAt(width, height))
  assert.equal(DEFAULT_GEOMETRY_POOL_BUDGET, 512 * MIB)
  assert.equal(DEFAULT_TEXTURE_POOL_BUDGET, 512 * MIB)
})

test('a larger declared canvas reserves more, and a canvas past it is the excess', () => {
  const uhd = { width: 7680, height: 4320 }
  const reserve = effectChainBytesAt(7680, 4320)
  assert.equal(
    splitMemoryBudget(DEFAULT_GPU_BUDGET * 2, DEFAULT_CACHED_BYTES, uhd).effectTargets,
    reserve,
  )
  // The default total, not raised with it, leaves the pools what the larger reserve spares.
  const squeezed = splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CACHED_BYTES, uhd)
  assert.ok(squeezed.geometryPool < DEFAULT_GEOMETRY_POOL_BUDGET)
  assert.throws(
    () => splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CACHED_BYTES, { width: 0, height }),
    /INVALID_BUDGET_CANVAS/,
  )
  assert.equal(effectTargetExcess(7680, 4320, DEFAULT_BUDGET_CANVAS), reserve - EFFECT_TARGET_BYTES)
  assert.equal(effectTargetExcess(width, height, DEFAULT_BUDGET_CANVAS), 0)
  assert.equal(effectTargetExcess(1920, 1080, DEFAULT_BUDGET_CANVAS), 0)
  assert.equal(effectTargetExcess(7680, 4320, uhd), 0)
})

test('the split reserves the effect targets before the pools, whose defaults stay', () => {
  const shares = splitMemoryBudget(DEFAULT_GPU_BUDGET, DEFAULT_CACHED_BYTES)
  assert.equal(shares.effectTargets, EFFECT_TARGET_BYTES)
  assert.equal(shares.geometryPool, DEFAULT_GEOMETRY_POOL_BUDGET)
  assert.equal(shares.texturePool, DEFAULT_TEXTURE_POOL_BUDGET)
  const fixed = SHADOW_POOL_BYTES + BOUNCE_PROBE_BYTES + EFFECT_TARGET_BYTES
  assert.equal(
    DEFAULT_GPU_BUDGET,
    fixed + DEFAULT_GEOMETRY_POOL_BUDGET + DEFAULT_TEXTURE_POOL_BUDGET,
  )
  assert.throws(() => splitMemoryBudget(fixed - 1, DEFAULT_CACHED_BYTES), /UNDER_SHADOW_POOL/)
  const least = splitMemoryBudget(fixed + 2, DEFAULT_CACHED_BYTES)
  assert.ok(fixed + least.geometryPool + least.texturePool <= fixed + 2)
})

test('a chain with no depth of field reads none of its settings, one with it reads them', () => {
  const read: string[] = []
  const context = new Proxy({}, { get: (_, name) => (read.push(String(name)), undefined) })
  const chain = createWorldEffects() // the motion blur and the bloom
  const settings = createKindSettings()
  const asked = () => read.some((name) => name.startsWith('depthOfField'))
  settings.drawn(chain.stage('before-resolve'), context, [])
  settings.moved(chain.passes, context)
  assert.equal(asked(), false, 'nothing is read for a kind the chain holds no pass of')
  chain.add(effect.depthOfField({ focusDistance: 2 }))
  assert.equal(settings.drawn(chain.stage('before-resolve'), context, []).length, 1)
  assert.equal(asked(), true)
})

test('the pass targets a chain gives back are retired with the frame that may still name them', async () => {
  const gpu = fakeDevice()
  const webgpu = createWebgpuEffects(gpu.device, (error) => assert.fail(String(error)))
  const [input, encoder] = [{} as GPUTextureView, gpu.device.createCommandEncoder()]
  const finish = createFinish(gpu.device)
  const draw = (passes: typeof chain) => {
    finish.scene.begin(encoder, input, 64, 32)
    const layers = finish.groupFor(false)
    webgpu.encode(encoder, passes, input, 64, 32, {
      scene: finish.scene,
      bare: finish.bare,
      layers,
      local: false,
      uniform: finish.uniform,
      lens: lensOf(null),
    })
  }
  draw(chain.slice(0, 2))
  await webgpu.settled()
  draw(chain.slice(0, 2))
  const targets = () => gpu.textures.filter(({ label }) => label?.includes('effect target'))
  assert.ok(targets().length > 0, 'a bloom another follows writes a target')
  draw([])
  assert.deepEqual([webgpu.bytes, targets().some((t) => gpu.destroyed.includes(t))], [0, false])
  destroyRetired(gpu.device)
  assert.ok(
    targets().every((target) => gpu.destroyed.includes(target)),
    'destroyed once the frame is',
  )
})
