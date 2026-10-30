// The motion blur on the resolved image compiles once, and its passes run in order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import {
  FILTERS,
  HEAD,
  blurring,
  filterCodes,
  flats,
  frameOf,
  input,
  loaded,
  recorder,
  strengthOf,
  uniformWord,
  wordsOf,
} from './webgpuEffects.fixture.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import {
  MOTION_BLUR_PARAMS,
  MOTION_BLUR_PARAMS_BYTES,
  TILE_CLASSES,
  TILE_FORMAT,
  classEntries,
  motionBlurBytes,
} from './motionBlur/motionBlurLayout.ts'
import { textureBytesOf } from '../../gpu/core/textureBytes.ts'
import { listBytes } from '../../gpu/dispatch/list.ts'

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

test('a blur set up ahead of the temporal pass leaves its flattening to the nearest velocity that wrote it', async () => {
  const dispatchesOf = async (limits: Record<string, number>, wrote: boolean) => {
    const made = await loaded({ limits })
    const chain = [effect.motionBlur({})]
    made.after.ready(chain)
    await made.effects.settled()
    const { encoder } = recorder(made.gpu)
    const frame = frameOf(made.gpu, 64, 32, {})
    const flatten = made.after.fuse(chain, frame)
    if (flatten) {
      Object.assign(frame, { flatten })
      flatten.written = wrote
    }
    made.after.resolve(encoder, chain, input, frame)
    return { flatten, entries: dispatchedEntries(made.gpu.dispatches) }
  }
  const wide = { maxStorageTexturesPerShaderStage: 8 }
  // The temporal pass wrote the motion: the blur's dispatches begin at its spread.
  const written = await dispatchesOf(wide, true)
  assert.deepEqual(written.entries, [...HEAD.slice(1), ...FILTERS])
  // Its dispatch not made (the program compiling): the blur flattens its own, set up all the same.
  const waiting = await dispatchesOf(wide, false)
  assert.deepEqual(waiting.entries, [...HEAD, ...FILTERS])
  assert.deepEqual(
    [written.flatten?.variant, written.flatten?.written, waiting.flatten?.token],
    [{ directions: 1, flat: 'packed' }, true, 1],
  )
  // A device that binds four storage textures to a stage cannot hold the nearest velocity's six.
  const narrow = await dispatchesOf({ maxStorageTexturesPerShaderStage: 4 }, true)
  assert.equal(narrow.flatten, undefined)
  assert.deepEqual(narrow.entries, [...HEAD, ...FILTERS])
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
  // 60 frames a second, a blur relative to 30: a scale of 2, an amount of 0.2 and a half for each
  // side of the streak; the longest streak 5 % of 64 pixels, a side.
  const words = [0, 1, 2, 3].map((k) => +uniformWord(gpu, 'scale', k).toFixed(4))
  assert.deepEqual(words, [6.4, -3.2, 1.6, 0.0625])
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

// The filter stores the half-size image as it stores the blurred one, so the scene's chain draws
// none over it: the last blur of a chain writes it, its uniform says so, and the stage hands it over.
test('the last blur of a chain writes the half-size image beside its own, which the stage hands over', async () => {
  const uniformsOf = (gpu: Awaited<ReturnType<typeof loaded>>['gpu']) =>
    [
      ...new Set(
        gpu.writes
          .map(({ buffer }) => buffer)
          .filter(({ size }) => size === MOTION_BLUR_PARAMS_BYTES),
      ),
    ].map((buffer) => wordsOf(buffer)[MOTION_BLUR_PARAMS.at.outputs])
  const half = (gpu: Awaited<ReturnType<typeof loaded>>['gpu']) =>
    gpu.textures
      .filter(({ label }) => label?.match(/half \d$/))
      .map(({ label, format, width, height }) => [label!.slice(-6), format, width, height])
  const alone = await blurring({}, {})
  const wrote = alone.after.resolve(alone.encoder, alone.chain, input, alone.frame)
  assert.notEqual(wrote, input)
  assert.deepEqual(uniformsOf(alone.gpu), [1], 'written')
  assert.deepEqual(
    half(alone.gpu),
    [['half 0', 'rgba16float', 32, 16]],
    'half the image, a texel each four',
  )
  assert.ok(alone.after.half, 'handed over')
  Object.assign(alone.frame, { still: true })
  assert.equal(alone.after.resolve(alone.encoder, alone.chain, input, alone.frame), input)
  assert.equal(
    alone.after.half,
    undefined,
    'a still image is left as it is, with no half of its own',
  )
  // A chain of two: only the second blur writes it.
  const two = await blurring({}, {}, { amount: 0.2 })
  two.after.resolve(two.encoder, two.chain, input, two.frame)
  assert.deepEqual(uniformsOf(two.gpu), [0, 1])
  assert.ok(two.after.half)
  // A separable blur: the second pass leaves the image, the first writes none.
  const apart = await blurring({ motionBlurSeparable: true }, {})
  apart.after.resolve(apart.encoder, apart.chain, input, apart.frame)
  assert.deepEqual(uniformsOf(apart.gpu), [0, 1])
  // An image lying in textures larger than itself — drawn below the display's size — has no half
  // of its own: the half-size image is of the textures'.
  const below = await blurring({}, {})
  Object.assign(below.frame, { size: [32, 16] })
  below.after.resolve(below.encoder, below.chain, input, below.frame)
  assert.deepEqual(uniformsOf(below.gpu), [0])
  assert.equal(below.after.half, undefined)
  // The quality that has the chain draw it (`temporalDownsampleQuality: 'high'`): the blur writes none.
  const high = await blurring({}, {})
  Object.assign(high.frame, { halfBeside: false })
  high.after.resolve(high.encoder, high.chain, input, high.frame)
  assert.deepEqual(uniformsOf(high.gpu), [0])
  assert.equal(high.after.half, undefined)
})

// The layers drawn after the motion blur are laid over the image the last pass of the last blur writes
// (`MotionBlurParams.outputs.y`, with where they lie), the half-size image included; a still image draws
// no blur, so nothing was laid.
test('the last blur of a chain lays the layers drawn after it over its image, as it writes it', async () => {
  const lateOf = (gpu: Awaited<ReturnType<typeof blurring>>['gpu']) =>
    [
      ...new Set(
        gpu.writes
          .map(({ buffer }) => buffer)
          .filter(({ size }) => size === MOTION_BLUR_PARAMS_BYTES),
      ),
    ].map((buffer) => {
      const words = wordsOf(buffer)
      return [words[MOTION_BLUR_PARAMS.at.outputs + 1], words[MOTION_BLUR_PARAMS.at.layers]]
    })
  const layers = { group: {} as GPUBindGroup, extent: [64, 32] }
  const none = await blurring({}, {})
  none.after.resolve(none.encoder, none.chain, input, none.frame)
  assert.deepEqual(lateOf(none.gpu), [[0, 0]])
  assert.notEqual(none.frame.lateComposed, true)
  const alone = await blurring({}, {})
  Object.assign(alone.frame, { lateLayers: layers })
  alone.after.resolve(alone.encoder, alone.chain, input, alone.frame)
  assert.deepEqual(lateOf(alone.gpu), [[1, 1 / 64]], 'the layers lie in textures of 64 × 32')
  assert.equal(alone.frame.lateComposed, true)
  // Layers drawn smaller than the render grid are read bilinear at the pixel's place in the texels drawn.
  const smaller = await blurring({}, {})
  Object.assign(smaller.frame, {
    lateLayers: { ...layers, drawn: [smaller.frame.render[0] / 2, smaller.frame.render[1] / 2] },
  })
  smaller.after.resolve(smaller.encoder, smaller.chain, input, smaller.frame)
  assert.deepEqual(lateOf(smaller.gpu), [[1, 0.5 / 64]], 'half the grid over the textures')
  assert.equal(smaller.frame.lateComposed, true)
  const two = await blurring({}, {}, { amount: 0.2 })
  Object.assign(two.frame, { lateLayers: layers })
  two.after.resolve(two.encoder, two.chain, input, two.frame)
  assert.deepEqual(
    lateOf(two.gpu).map(([on]) => on),
    [0, 1],
    'only the second blur',
  )
  const apart = await blurring({ motionBlurSeparable: true }, {})
  Object.assign(apart.frame, { lateLayers: layers })
  apart.after.resolve(apart.encoder, apart.chain, input, apart.frame)
  assert.deepEqual(
    lateOf(apart.gpu).map(([on]) => on),
    [0, 1],
    'the pass that leaves the image',
  )
  const still = await blurring({}, {})
  Object.assign(still.frame, { lateLayers: layers, still: true })
  still.after.resolve(still.encoder, still.chain, input, still.frame)
  assert.notEqual(
    still.frame.lateComposed,
    true,
    'a still image draws no blur: left to the composition',
  )
})

// A thread of a half-resolution class holds a quad: the mean of its four colours is its texel. A
// thread of a full-resolution one holds a pixel: the lanes of a quad gather in workgroup memory —
// the lanes a pixel across and a row down in raster order, the four consecutive lanes in Z order —,
// never through the subgroup, which ties no lane to a place in the workgroup.
test('the filters store the half-size image: a quad’s mean, gathered through workgroup memory', async () => {
  for (const [codes, quad] of [
    [await filterCodes([]), 'let top=lane&~(1u|TILE);'],
    [await filterCodes(['subgroups']), 'let top=lane&~3u;'],
  ] as const) {
    for (const code of codes) {
      assert.ok(code.includes('textureStore(halfOut,texel,mean)'))
      assert.ok(code.includes('halfTile[lane]=taken;') && code.includes(quad), quad)
      assert.ok(!code.includes('subgroupShuffle'), 'no shuffle')
      assert.equal(code.split('workgroupBarrier()').length - 1, code.includes('atomicMax') ? 3 : 1)
    }
  }
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
  // The second blur's own image, its half-size one, uniform and four lists.
  const lists = TILE_CLASSES.length * listBytes(classEntries(128, 64), 1)
  const own = 8 * 128 * 64 + 8 * 64 * 32 + MOTION_BLUR_PARAMS_BYTES + lists
  assert.equal(effects.bytes, motionBlurBytes(128, 64) + own)
  assert.equal(after.resolve(encoder, [], input, frame), input)
  assert.equal(effects.bytes, 0, 'an emptied chain gives everything back')
  destroyRetired(gpu.device)
  const made = gpu.textures.filter(({ label }) => label?.startsWith('Trillion3D motion blur'))
  for (const texture of made) assert.ok(gpu.destroyed.includes(texture), texture.label)
})
