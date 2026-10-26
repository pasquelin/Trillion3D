// The WebGPU effect chain: an empty chain adds no pass, no copy and no target; a chain with a
// bloom makes its images at the first frame that draws it, keeps them while the size holds, counts
// their bytes, and gives them back when it empties; every bloom blurs with its own settings.
import test from 'node:test'
import assert from 'node:assert/strict'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { bloomTintScale } from './bloom/bloomFilter.ts'
import { BLUR_BYTES, BLUR_PARAMS } from '../filters/gaussianWgsl.ts'
import {
  DEFAULT_BLOOM,
  drawn,
  floatsOf,
  input,
  loaded,
  recorder,
  viewOf,
} from './webgpuEffects.fixture.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { chainSizes } from '../filters/levelSizes.ts'
import { BLOOM_LEVEL_COUNT } from '../../../../sdk-core/src/contracts/bloomOptions.ts'

/** Bytes of the targets of a bloom's six blurs on an image: each level twice, as wide as it is. */
const blurBytes = (width: number, height: number) =>
  chainSizes(width, height, BLOOM_LEVEL_COUNT).reduce((sum, [w, h]) => sum + 2 * 8 * w * h, 0)
/** The scene's half-size image and its five levels, drawn once a frame, and the blurs' 6 × 2. */
const SCENE_PASSES = 6,
  BLUR_PASSES = 12

test('an empty chain returns its input and creates, writes and encodes nothing', async () => {
  const { gpu, effects, frame } = await loaded()
  const { encoder, passes } = recorder(gpu)
  const post = frame(encoder, 64, 32)
  const [textures, buffers, writes] = [gpu.textures.length, gpu.buffers.length, gpu.writes.length]
  assert.equal(effects.encode(encoder, [], input, 64, 32, post), input)
  assert.deepEqual(
    [passes.length, gpu.textures.length, gpu.buffers.length, gpu.writes.length],
    [0, textures, buffers, writes],
  )
  assert.equal(gpu.renderPipelines.length, 0, 'not even a program is compiled')
  assert.equal(effects.bytes, 0)
})

test('an idle bloom, or one the view turns off, is no pass: nothing is drawn, nor compiled', async () => {
  const { gpu, effects, frame } = await loaded()
  const { encoder, passes } = recorder(gpu)
  const bloom = effect.bloom({ intensity: 0 })
  assert.equal(drawn([effect.bloom()], { bloomQuality: 'off' }).length, 0, 'the quality off')
  assert.equal(
    effects.encode(encoder, drawn([bloom]), input, 64, 32, frame(encoder, 64, 32)),
    input,
  )
  assert.deepEqual([passes.length, gpu.renderPipelines.length, effects.loading], [0, 0, false])
})

test('a bloom compiles once, then draws its levels; the composition adds its glow', async () => {
  const { gpu, effects, frame } = await loaded()
  const bloom = effect.bloom()
  const { encoder, passes } = recorder(gpu)
  assert.equal(
    effects.encode(encoder, [bloom], input, 64, 32, frame(encoder, 64, 32)),
    input,
    'compiling: no chain yet',
  )
  assert.equal(effects.loading, true)
  await effects.settled()
  // The chain's last bloom leaves its glow to the composition, which reads the image it read.
  assert.equal(effects.encode(encoder, [bloom], input, 64, 32, frame(encoder, 64, 32)), input)
  assert.equal(effects.draws, BLUR_PASSES, 'a blur of the six levels, two passes each')
  assert.equal(passes.length, SCENE_PASSES + BLUR_PASSES, 'after the scene’s levels')
  assert.ok(effects.blend?.glow, 'its glow, for the composition')
  assert.equal(effects.bytes, blurBytes(64, 32), 'the blurs’ targets: the chain is the scene’s')
  const textures = gpu.textures.length,
    groups = gpu.bindGroups.length,
    writes = gpu.writes.length
  effects.encode(encoder, [bloom], input, 64, 32, frame(encoder, 64, 32))
  assert.deepEqual(
    [gpu.textures.length, gpu.bindGroups.length, gpu.writes.length],
    [textures, groups, writes],
    'nothing remade, no group made again, nothing rewritten',
  )
  bloom.intensity = 0.25
  effects.encode(encoder, [bloom], input, 64, 32, frame(encoder, 64, 32))
  assert.equal(gpu.writes.length, writes + 6, 'the tint of each of the six second passes')
  effects.encode(encoder, [bloom], input, 128, 64, frame(encoder, 128, 64))
  assert.equal(effects.bytes, blurBytes(128, 64), 'the images follow the size')
  effects.encode(encoder, [], input, 128, 64, frame(encoder, 128, 64))
  assert.equal(effects.bytes, 0, 'an emptied chain gives its images back')
  // The image's commands may still name them: retired, destroyed after its submit.
  destroyRetired(gpu.device)
  const blurred = gpu.textures.filter((texture) => texture.label === 'Trillion3D bloom')
  assert.ok(blurred.length > 0)
  for (const texture of blurred) assert.ok(gpu.destroyed.includes(texture), texture.label)
})

test('a bloom with a threshold draws a setup and a chain of its own, under the image’s', async () => {
  const { gpu, effects, frame } = await loaded()
  const bloom = effect.bloom({ threshold: 1 })
  const { encoder, passes } = recorder(gpu)
  effects.encode(encoder, [bloom], input, 64, 32, frame(encoder, 64, 32))
  await effects.settled()
  passes.length = 0
  effects.encode(encoder, [bloom], input, 64, 32, frame(encoder, 64, 32))
  // The scene's half-size image alone, the setup, its five levels, the blurs.
  assert.equal(passes.length, 1 + 1 + 5 + BLUR_PASSES)
  assert.equal(effects.draws, 1 + 5 + BLUR_PASSES)
  bloom.threshold = -1
  passes.length = 0
  effects.encode(encoder, [bloom], input, 64, 32, frame(encoder, 64, 32))
  assert.equal(passes.length, SCENE_PASSES + BLUR_PASSES, 'no threshold: the scene’s levels again')
})

test('a bloom another pass follows writes the target the next one reads', async () => {
  const { gpu, effects, frame } = await loaded()
  const { encoder, passes } = recorder(gpu)
  const chain = [effect.bloom(), effect.bloom()]
  effects.encode(encoder, chain, input, 64, 32, frame(encoder, 64, 32))
  await effects.settled()
  passes.length = 0
  const output = effects.encode(encoder, chain, input, 64, 32, frame(encoder, 64, 32))
  // The scene's levels once, the first bloom's blurs and the pass that adds its glow, the second's.
  assert.equal(passes.length, SCENE_PASSES + 2 * BLUR_PASSES + 1)
  assert.equal(viewOf(passes[SCENE_PASSES + BLUR_PASSES]), output, 'the first wrote its glow in')
  assert.notEqual(output, input)
  assert.ok(effects.blend, 'the second leaves its glow to the composition')
})

/** The weights each blur uniform of a bloom holds on its red channel, summed over its reads, in the
 *  order they were made: 1 for the first pass of a level, its tint times the glow's scale for the second. */
function sums(gpu: Awaited<ReturnType<typeof loaded>>['gpu']) {
  return gpu.buffers
    .filter(({ size }) => size === BLUR_BYTES)
    .map((buffer) => {
      const words = floatsOf(buffer)
      let sum = 0
      for (let i = 0; i < words[BLUR_PARAMS.at.count]; i++)
        sum += words[BLUR_PARAMS.at.taps + 4 * i + 1]
      return sum
    })
}

test('two blooms blur with their own settings, each from its own uniforms', async () => {
  const { gpu, effects, frame } = await loaded()
  const { encoder } = recorder(gpu)
  const chain = [effect.bloom({ intensity: 0.2 }), effect.bloom({ intensity: 0.8 })]
  effects.encode(encoder, chain, input, 64, 32, frame(encoder, 64, 32))
  await effects.settled()
  effects.encode(encoder, chain, input, 64, 32, frame(encoder, 64, 32))
  const scale = [0.2, 0.8].map(bloomTintScale)
  const expected = scale.flatMap((s) => [
    ...DEFAULT_BLOOM.levels.map(() => 1),
    ...DEFAULT_BLOOM.levels.map(({ tint }) => tint[0] * s),
  ])
  const found = sums(gpu)
  assert.equal(found.length, expected.length)
  // A bloom's blurs are written level by level, the widest first: its two uniforms each.
  const widest = (n: number) => [n, n + 1].map((i) => found[i])
  assert.deepEqual(
    [widest(0), widest(12)].flat().map((sum) => Number(sum.toFixed(5))),
    [1, DEFAULT_BLOOM.levels[5].tint[0] * scale[0], 1, DEFAULT_BLOOM.levels[5].tint[0] * scale[1]]
      .map((sum) => Number(sum.toFixed(5)))
      .flat(),
  )
  assert.deepEqual(
    [...found].sort((a, b) => a - b).map((sum) => Number(sum.toFixed(5))),
    [...expected].sort((a, b) => a - b).map((sum) => Number(sum.toFixed(5))),
    'each bloom’s tints are scaled by its own intensity, over six levels',
  )
})
