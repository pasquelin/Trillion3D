// The WebGPU effect chain: an empty chain adds no pass, no copy and no target; a chain with a
// bloom makes its images at the first frame that draws it, keeps them while the size holds, counts
// their bytes, and gives them back when it empties; every bloom blurs with its own settings; the
// motion blur on the resolved image compiles once, and its passes run in order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { bloomTintScale } from './bloom/bloomFilter.ts'
import { BLUR_BYTES, BLUR_PARAMS } from '../filters/gaussianWgsl.ts'
import {
  DEFAULT_BLOOM,
  FILTERS,
  HEAD,
  blurring,
  drawn,
  filterCodes,
  flats,
  floatsOf,
  frameOf,
  input,
  loaded,
  recorder,
  strengthOf,
  uniformWord,
  viewOf,
} from './webgpuEffects.fixture.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { chainSizes } from '../filters/levelSizes.ts'
import { BLOOM_LEVEL_COUNT } from '../../../../sdk-core/src/contracts/bloomOptions.ts'
import { dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import {
  MOTION_BLUR_PARAMS_BYTES,
  TILE_CLASSES,
  TILE_FORMAT,
  classEntries,
  motionBlurBytes,
} from './motionBlur/motionBlurLayout.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { listBytes } from '../../gpu/dispatch/list.ts'

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

test('a motion blur compiles once, then runs the passes its settings name', async () => {
  const { effects, after } = await loaded()
  assert.equal(after.ready([effect.motionBlur()]), false, 'compiling: the image is drawn unblurred')
  assert.equal(effects.loading, true)
  await effects.settled()
  const bytes = motionBlurBytes(64, 32),
    second = 8 * 64 * 32 + MOTION_BLUR_PARAMS_BYTES
  const drawnSpread = [HEAD[0], ...HEAD.slice(2), ...FILTERS]
  // A drawn spread: a compute pass, two draws of the tiles — eight an instance —, a compute pass.
  for (const [settings, entries, passes, draws, held] of [
    [{}, [...HEAD, ...FILTERS], 1, [], bytes],
    [{ motionBlurScatter: true }, drawnSpread, 3, [48, 1, 48, 1], bytes],
    [{ motionBlurSeparable: true }, [...HEAD, ...FILTERS, ...FILTERS], 1, [], bytes + second],
  ] as const) {
    const made = await blurring(settings, {})
    assert.notEqual(made.after.resolve(made.encoder, made.chain, input, made.frame), input)
    const seen = made.gpu.draws.flatMap((d) => [d.vertexCount, d.instanceCount])
    assert.deepEqual(
      [dispatchedEntries(made.gpu.dispatches), made.after.passes, seen, made.effects.bytes],
      [entries, passes, draws, held],
    )
  }
})

test('the uniform holds the motion scaled to pixels, rewritten only where it changes', async () => {
  const { gpu, chain, encoder, frame, after } = await blurring({}, {})
  const resolve = (now: number, still = false) => {
    Object.assign(frame, { now, still })
    return after.resolve(encoder, chain, input, frame)
  }
  assert.equal(resolve(0, true), input, 'a still image is left as it is')
  assert.deepEqual([after.passes, gpu.dispatches.length, gpu.writes.length], [0, 0, 0])
  resolve(1000 / 60)
  const [textures, groups, writes] = [gpu.textures.length, gpu.bindGroups.length, gpu.writes.length]
  resolve(2000 / 60)
  assert.deepEqual([gpu.textures.length, gpu.bindGroups.length], [textures, groups])
  assert.ok(gpu.writes.length - writes <= TILE_CLASSES.length, 'the uniform is not rewritten')
  // 60 frames a second, a blur relative to 30: a scale of 2, an amount of a half and a half again
  // for each side of the streak; the longest streak 5 % of 64 pixels, a side.
  const words = [0, 1, 2, 3].map((k) => +uniformWord(gpu, 'scale', k).toFixed(4))
  assert.deepEqual(words, [16, -8, 1.6, 0.0625])
})

test('the view’s scale and overrides set the strength and the streak; the half-size input is the temporal pass’s', async () => {
  const [quarter, scaled] = [{ amount: 0.25 }, { motionBlurScale: 2 }]
  // A quarter at the first image's scale of 1, 64 pixels wide, half of it a side.
  assert.deepEqual(await strengthOf({}, quarter), [4, Math.fround(1.6), 1])
  assert.equal((await strengthOf(scaled, quarter))[0], 8)
  assert.equal((await strengthOf({ ...scaled, motionBlurAmountOverride: 1 }))[0], 16)
  assert.equal((await strengthOf({ motionBlurMaxOverride: 10 }))[1], Math.fround(3.2))
  assert.equal((await strengthOf({}, {}, false))[2], 0, 'the image of no temporal pass')
})

test('an orthographic view keeps the flattened motion in floats, the perspective’s drawn meanwhile', async () => {
  const { gpu, effects, chain, encoder, frame, after } = await blurring({}, {})
  frame.camera = { ...frame.camera, perspective: false }
  after.resolve(encoder, chain, input, frame)
  assert.deepEqual([effects.loading, flats(gpu)], [true, ['r32uint']])
  await effects.settled()
  after.resolve(encoder, chain, input, frame)
  assert.deepEqual([effects.loading, flats(gpu)], [false, ['r32uint', 'rgba32float']])
})

test('the filters vote by the subgroup where the device grants subgroups, by the workgroup else', async () => {
  const [plain, voting] = [await filterCodes([]), await filterCodes(['subgroups'])]
  assert.deepEqual([plain.length, voting.length], [4, 4])
  assert.ok(plain.every((code) => code.includes('atomicMax') && !code.includes('subgroupMax')))
  assert.ok(voting.every((code) => code.includes('subgroupMax') && !code.includes('atomicMax')))
})

test('a blur of two directions is drawn with one until its programs arrive, then in five classes', async () => {
  const { gpu, effects, chain, encoder, frame, after } = await blurring(
    { motionBlurDirections: 2 },
    {},
  )
  const drawn = () => [effects.loading, dispatchedEntries(gpu.dispatches)]
  after.resolve(encoder, chain, input, frame)
  assert.deepEqual(drawn(), [true, [...HEAD, ...FILTERS]], 'one direction, drawn again after')
  await effects.settled()
  gpu.dispatches.length = 0
  after.resolve(encoder, chain, input, frame)
  assert.deepEqual(drawn(), [false, [...HEAD, ...FILTERS, 'filterTwoTiles']])
  // The images of the second largest motions, twice, and the fifth class's list.
  const seconds = 2 * textureBytesOf({ size: [4, 2], format: TILE_FORMAT })!
  assert.equal(
    effects.bytes,
    motionBlurBytes(64, 32) + seconds + listBytes(classEntries(64, 32), 1),
  )
  frame.session = frameOf(gpu, 64, 32).session
  after.resolve(encoder, chain, input, frame)
  assert.equal(effects.bytes, motionBlurBytes(64, 32), 'one direction: what it always held')
})

test('two blurs take turns on two images, which follow the size and are given back', async () => {
  const { gpu, effects, chain, encoder, frame, after } = await blurring({}, {}, { amount: 0.2 })
  const first = after.resolve(encoder, chain.slice(0, 1), input, frame)
  const last = after.resolve(encoder, chain, input, frame)
  assert.ok(last !== first && last !== input, 'the second reads the first’s image')
  after.resolve(encoder, chain, input, frameOf(gpu, 128, 64))
  // The second blur's own image, uniform and four lists.
  const lists = TILE_CLASSES.length * listBytes(classEntries(128, 64), 1)
  const own = 8 * 128 * 64 + MOTION_BLUR_PARAMS_BYTES + lists
  assert.equal(effects.bytes, motionBlurBytes(128, 64) + own)
  assert.equal(after.resolve(encoder, [], input, frame), input)
  assert.equal(effects.bytes, 0, 'an emptied chain gives everything back')
  destroyRetired(gpu.device)
  const made = gpu.textures.filter(({ label }) => label?.startsWith('Trillion3D motion blur'))
  for (const texture of made) assert.ok(gpu.destroyed.includes(texture), texture.label)
})
