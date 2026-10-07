// The WebGPU effect chain: an empty chain adds no pass, no copy and no target; a chain
// with a bloom makes its targets at the first frame that draws it, keeps them while the size
// holds, counts their bytes, and gives them back when it empties.
import test from 'node:test'
import assert from 'node:assert/strict'
import { written } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { bloomBlend, bloomLevelBytes, bloomLevelSizes } from '../../effects/bloomFilter.ts'
import { input, loaded, recorder, floatsOf } from './webgpuEffects.fixture.ts'
import { uniformStride } from '../../residency/pools.ts'

test('an empty chain returns its input and creates, writes and encodes nothing', async () => {
  const { gpu, effects } = await loaded()
  const { encoder, passes } = recorder()
  assert.equal(effects.encode(encoder, [], input, 64, 32), input)
  assert.deepEqual(
    [passes.length, gpu.textures.length, gpu.buffers.length, gpu.writes.length],
    [0, 0, 0, 0],
  )
  assert.equal(gpu.renderPipelines.length, 0, 'not even a program is compiled')
  assert.equal(effects.bytes, 0)
})

test('a bloom compiles once, then draws 2 × levels passes into targets made once per size', async () => {
  const { gpu, effects } = await loaded()
  const bloom = effect.bloom({ intensity: 0.5 })
  const { encoder, passes } = recorder()
  assert.equal(effects.encode(encoder, [bloom], input, 64, 32), input, 'compiling: no chain yet')
  assert.equal(effects.loading, true)
  await effects.settled()
  const levels = bloomLevelSizes(64, 32).length
  const output = effects.encode(encoder, [bloom], input, 64, 32)
  assert.notEqual(output, input)
  assert.equal(passes.length, 2 * levels)
  assert.equal(effects.draws, 2 * levels)
  assert.deepEqual(
    passes.map((pass) => pass.load),
    [...Array(levels).fill('clear'), ...Array(levels - 1).fill('load'), 'clear'],
    'down the levels, up adding into each, then the blend',
  )
  assert.equal(passes.at(-1)!.view, output)
  assert.equal(effects.bytes, 64 * 32 * 8 + bloomLevelBytes(64, 32))
  const made = gpu.textures.length,
    writes = gpu.writes.length
  assert.equal(made, 2, 'one pass target and the level chain')
  // At 256 bytes the range goes up as one write, as the whole range did, never longer than it.
  const uniform = gpu.writes.filter((w) => w.buffer.label === 'Trillion3D bloom uniform')
  assert.equal(uniform.length, 1, 'the range in one write')
  assert.ok(written(uniform[0]).byteLength <= 2 * levels * 256)
  effects.encode(encoder, [bloom], input, 64, 32)
  assert.deepEqual(
    [gpu.textures.length, gpu.writes.length],
    [made, writes],
    'nothing remade or rewritten',
  )
  bloom.intensity = 0.25
  effects.encode(encoder, [bloom], input, 64, 32)
  assert.equal(gpu.writes.length, writes + 1, 'a setting rewrites the uniform once')
  effects.encode(encoder, [bloom], input, 128, 64)
  assert.equal(
    effects.bytes,
    128 * 64 * 8 + bloomLevelBytes(128, 64),
    'the targets follow the size',
  )
  effects.encode(encoder, [], input, 128, 64)
  assert.equal(effects.bytes, 0, 'an emptied chain gives its targets back')
  for (const texture of gpu.textures) assert.ok(gpu.destroyed.includes(texture), texture.label)
})

test('two passes read each other through two targets in turn', async () => {
  const { gpu, effects } = await loaded()
  const { encoder, passes } = recorder()
  const chain = [effect.bloom(), effect.bloom()]
  effects.encode(encoder, chain, input, 64, 32)
  await effects.settled()
  const output = effects.encode(encoder, chain, input, 64, 32)
  const each = 2 * bloomLevelSizes(64, 32).length
  assert.equal(gpu.textures.length, 3, 'two pass targets and the level chain')
  assert.equal(passes.length, 2 * each)
  assert.notEqual(passes[each - 1].view, output, 'the first writes one target')
  assert.equal(passes[2 * each - 1].view, output, 'the second the other, which composition reads')
})

test('two blooms draw with their own settings, each from its own uniform range', async () => {
  const { gpu, effects } = await loaded()
  const { encoder, passes } = recorder()
  const chain = [effect.bloom({ intensity: 0.2 }), effect.bloom({ intensity: 0.8, radius: 2 })]
  effects.encode(encoder, chain, input, 64, 32)
  await effects.settled()
  passes.length = 0
  effects.encode(encoder, chain, input, 64, 32)
  // The uniform buffer as the queue leaves it before the frame's first pass.
  const uniform = gpu.buffers.find((buffer) => buffer.label === 'Trillion3D bloom uniform')!
  const floats = new Float32Array(uniform.size / 4)
  for (const write of gpu.writes)
    if (write.buffer === (uniform as unknown)) floats.set(floatsOf(write), write.offset / 4)
  const levels = bloomLevelSizes(64, 32).length,
    each = 2 * levels
  chain.forEach((bloom, n) => {
    const at = passes[(n + 1) * each - 1].offset! / 4,
      { keep, glow } = bloomBlend(bloom.intensity, levels)
    assert.deepEqual(
      [...floats.subarray(at + 4, at + 7)],
      [bloom.radius, keep, glow].map(Math.fround),
      `bloom ${n} blends with its own intensity and radius`,
    )
  })
})

test('a fused chain leaves its last blend to the composition: one pass and one target fewer', async () => {
  const { gpu, effects } = await loaded()
  const { encoder, passes, handed } = recorder()
  const bloom = effect.bloom({ intensity: 0.5 })
  effects.encode(encoder, [bloom], input, 64, 32)
  await effects.settled()
  const levels = bloomLevelSizes(64, 32).length
  effects.encode(encoder, [bloom], input, 64, 32)
  assert.equal(gpu.textures.length, 2, 'unfused: a pass target and the level chain')
  assert.equal(effects.blend, undefined)
  passes.length = 0
  assert.equal(
    effects.encode(encoder, [bloom], input, 64, 32, true),
    input,
    'composition reads the input',
  )
  assert.equal(passes.length, 2 * levels - 1, 'no blend pass')
  assert.equal(effects.draws, 2 * levels - 1)
  assert.ok(passes.every((pass) => pass.view !== input && pass.label === 'Trillion3D bloom'))
  const stride = uniformStride(gpu.device.limits)
  assert.equal(effects.blend!.offset, (2 * levels - 1) * stride, 'the blend reads its own slot')
  const fused = effects.blend,
    kept = handed.size
  effects.encode(encoder, [bloom], input, 64, 32, true)
  assert.equal(effects.blend, fused, 'the same blend, kept from frame to frame')
  assert.equal(
    handed.size,
    kept,
    'a frame hands the descriptor and offset arrays it had: none made',
  )
  assert.equal(gpu.destroyed.length, 1, 'the pass target is given back')
  assert.equal(effects.bytes, bloomLevelBytes(64, 32))
  // Two blooms: the first writes the one target left, the second blends it in the composition.
  const chain = [effect.bloom(), bloom]
  passes.length = 0
  const output = effects.encode(encoder, chain, input, 64, 32, true)
  assert.equal(passes.length, 4 * levels - 1)
  assert.equal(passes[2 * levels - 1].view, output, 'the first bloom wrote what the second read')
  assert.equal(effects.bytes, 64 * 32 * 8 + bloomLevelBytes(64, 32))
  assert.equal(effects.blend!.offset, (4 * levels - 1) * stride, 'the second bloom’s last slot')
  effects.encode(encoder, [bloom], input, 64, 32)
  assert.equal(effects.blend, undefined, 'unfused again, the bloom blends itself')
})
