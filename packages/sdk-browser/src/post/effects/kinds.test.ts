// The motion blur's shaders, run in JavaScript on the text the engine compiles, and its passes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import {
  blurring,
  drawn,
  frameOf,
  input as resolved,
  loaded,
  recorder,
  wordsOf,
} from './webgpuEffects.fixture.ts'
import { motionBlurBytes } from './motionBlur/motionBlurLayout.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { gatherShader } from './motionBlur/dilateWgsl.ts'
import { classifyShader } from './motionBlur/classifyWgsl.ts'
import { flattenShader } from './motionBlur/flattenWgsl.ts'
import {
  GREY,
  MOVING,
  NONE,
  blurUniform,
  filterRun,
  gatheredSeconds,
  TWO_SCENES,
  twoStreak,
  near,
  weighedStreak,
  type Vec,
} from './motionBlur/motionBlurRun.fixture.ts'
import { createMotionBlurClock } from './motionBlur/motionBlurClock.ts'
import { spreadsByDrawing } from './motionBlur/motionBlurParams.ts'

test('a tile keeps the longest and the shortest motion of its texels, as a length and an angle', () => {
  const { toPolar, toCartesianRange, toPolarRange, reduceRange } = shaderRun<{
    toPolar: (v: Vec) => Vec
    toCartesianRange: (r: Vec) => Vec
    toPolarRange: (r: Vec) => Vec
    reduceRange: (a: Vec, b: Vec) => Vec
  }>(gatherShader(), ['toPolar', 'toCartesianRange', 'toPolarRange', 'reduceRange'], {
    mb: blurUniform,
  })
  near(toPolar([3, 4]), [5, Math.atan2(4, 3)])
  assert.deepEqual(toPolar([0, 0]), [0, 0], 'a motion of no length has no angle')
  // (largest length, angle, smallest length, angle): the longer largest, the shorter smallest.
  const a = [5, 0.5, 2, 0.1],
    b = [7, 1.5, 3, 0.2]
  assert.deepEqual(reduceRange(a, b), [7, 1.5, 2, 0.1])
  assert.deepEqual(reduceRange(b, a), [7, 1.5, 2, 0.1])
  // On equal lengths the largest is the second's and the smallest the first's.
  assert.deepEqual(reduceRange(a, [5, 2.5, 2, 0.9]), [5, 2.5, 2, 0.1])
  near(toCartesianRange(toPolarRange([1, -1, 3, 4])), [1, -1, 3, 4]) // a tile texel there and back
  // With two directions a range keeps a second largest motion: where the largest motions lie within
  // 5 degrees the longer second stays, else the longest of the shorter largest and both seconds.
  const { reduceSecond } = shaderRun<{ reduceSecond: (a: Vec, s: Vec, b: Vec, t: Vec) => Vec }>(
    flattenShader(2),
    ['reduceSecond'],
    {},
  )
  const second = (angle: number, seconds = [2, 1]) =>
    reduceSecond([5, 0, 2, 0], seconds, [7, angle, 3, 0], [3, 2])
  assert.deepEqual(second(0.05), [3, 2], 'one largest: the longer second')
  assert.deepEqual(second(1), [5, 0], 'two: the shorter largest')
  assert.deepEqual(second(1, [6, 1]), [6, 1], 'or a longer second')
  assert.deepEqual(
    reduceSecond([5, 3.14, 2, 0], [2, 1], [7, -3.14, 3, 0], [3, 2]),
    [3, 2],
    'a turn',
  )
})

test('the largest motion of a tile reaches the tiles its streak crosses, one tile wide', () => {
  const { tileStreakCovers } = shaderRun<{ tileStreakCovers: (n: Vec, o: Vec) => boolean }>(
    gatherShader(),
    ['tileStreakCovers'],
    { mb: blurUniform },
  )
  // 32 pixels along x: two tiles, each way from the tile's centre, and no tile beside the line.
  const along = [0, 0, 32, 0]
  for (const x of [-2, -1, 1, 2]) assert.equal(tileStreakCovers(along, [x, 0]), true, `x ${x}`)
  for (const tile of ['3,0', '0,1', '1,1', '-2,-1'])
    assert.equal(tileStreakCovers(along, tile.split(',').map(Number)), false, tile)
  // Along the diagonal the streak is as wide as a tile's extent across it.
  const slanted = [0, 0, 16, 16]
  assert.equal(tileStreakCovers(slanted, [1, 1]), true)
  assert.equal(tileStreakCovers(slanted, [1, -1]), false)
})

test('each tile suggests the cheapest class that gives its motion its due', () => {
  const run = (knobs: number[]) =>
    shaderRun<{ suggestedClass: (range: Vec) => number }>(classifyShader(), ['suggestedClass'], {
      mb: { ...blurUniform, knobs },
    }).suggestedClass
  const classOf = run([16, 0, 1, 0])
  assert.equal(classOf([0, 0, 0.4, 0]), 0, 'a motion under half a pixel: the copy')
  assert.equal(classOf([3, 0, 4, 0]), 1, 'one motion all over the tile: the gather')
  assert.equal(classOf([0, 0, 4, 0]), 3, 'a still pixel in a moving tile: the weighing')
  assert.equal(classOf([19, 0, 20, 0]), 1, 'half resolution is not allowed')
  const halved = run([16, 1, 1, 0])
  assert.equal(halved([19, 0, 20, 0]), 0, 'a motion past the samples a pixel takes: half the size')
  assert.equal(halved([0, 0, 20, 0]), 2)
  assert.equal(halved([3, 0, 4, 0]), 1, 'a short motion is gathered at the size of the image')
  assert.equal(halved([0, 0, 0.4, 0]), 0)
  // With two directions a second motion of half a pixel makes the class of two motions.
  const { suggestedClass: twice } = shaderRun<{ suggestedClass: (r: Vec, s: Vec) => number }>(
    classifyShader(2),
    ['suggestedClass'],
    { mb: { ...blurUniform, knobs: [16, 1, 1, 0] } },
  )
  assert.deepEqual(
    [
      [3, 0, 4, 0],
      [0, 0, 20, 0],
      [0, 0, 0.4, 0],
    ].map((r) => twice(r, [0, 0.5])),
    [4, 4, 0],
  )
  assert.deepEqual([twice([3, 0, 4, 0], [0, 0.4]), twice([0, 0, 20, 0], [0, 0])], [1, 2])
})

test('a streak is the mean of the samples it is asked for; of one motion and one depth, weighed whole', () => {
  const { gatherStreak, weighStreak, loads } = filterRun(GREY, MOVING)
  for (const count of [4, 8, 12, 16]) {
    loads.colour = 0
    near(gatherStreak([0.5, 0.5], [0.125, 0], 0.3, count, 1 / count, 0), [0.2, 0.4, 0.6, 1])
    assert.equal(loads.colour, count, `${count} samples`)
    const { color, weight } = weighStreak([0.5, 0.5], [8, 0], 0.3, count, 0)
    near(color, [0.2, 0.4, 0.6, 1])
    assert.equal(Number(weight.toFixed(6)), 1, `${count} samples, none of the pixel’s own`)
  }
})

test('a still foreground is not smeared over the moving background, nor the background onto it', () => {
  // The pixel is a still surface 2 m away; along its streak, a background 10 m away moving 32
  // pixels. The streak's samples are at least a pixel from the pixel's own texel.
  const foreground = filterRun(
    (x) => (x < 32 ? [1, 0, 0, 1] : [0, 0, 1, 1]),
    (x) => (x === 32 ? [0, 0.5, 2, 0] : [32, 0.5, 10, 0]),
  )
  const kept = foreground.weighStreak([32.5 / 64, 0.5], [32, 0], 0.3, 16, 0)
  assert.equal(kept.weight, 0, 'the nearer, still centre takes none of what is behind it')
  // The reverse: a moving background pixel with a still foreground along its streak.
  const background = filterRun(
    () => [0, 0, 1, 1],
    (x) => (x === 32 ? [32, 0.5, 10, 0] : [0, 0.5, 2, 0]),
  )
  assert.equal(
    background.weighStreak([32.5 / 64, 0.5], [32, 0], 0.3, 16, 0).weight,
    0,
    'and a surface behind a nearer still one takes none of its colour',
  )
})

test('a moving surface in front blurs over the still one behind its edge', () => {
  const { weighStreak } = filterRun(
    (x) => (x < 32 ? [1, 0, 0, 1] : [0, 0, 1, 1]),
    (x) => (x < 32 ? [8, 0.5, 2, 0] : [0, 0.5, 10, 0]),
  )
  // A still, farther pixel just past the edge: the nearer, moving samples reach it.
  const { color, weight } = weighStreak([34.5 / 64, 0.5], [8, 0], 0.3, 16, 0)
  assert.ok(weight > 0.2 && weight < 1, `weight ${weight}`)
  assert.ok(color[0] > 0 && color[2] > 0, 'the red of the surface in front, the blue of the pixel')
})

test('the class of two motions gathers a pixel along both, and fills what one leaves from the other', () => {
  // The pixel moves along its row, its column along it (`TWO_SCENES`), eight samples each. Every
  // sample takes its colour whole; the column's depth weights, offset by its step and its place,
  // reach 3.5 of 4 (its last pair lies past its streak's reach: half), so its opacity is 0.875 and
  // the row's 1, none of the pixel's own colour left: the colours are the means of the texels.
  const both = twoStreak(TWO_SCENES.rowAndColumn)
  near(both.color, [(0.4921875 + 0.875 * 0.5) / 1.875, (0.5 + 0.875 * 0.484375) / 1.875, 0, 1])
  assert.equal(both.blend, 0)
  near(twoStreak(TWO_SCENES.row).color, [0.4921875, 0.5, 0, 1])
  // Half the row a farther, still surface: its colours fill what the moving half leaves open.
  near(twoStreak(TWO_SCENES.rowOverSurface).color, [0.4921875, 0.5, 0, 1], 7)
  // With one motion the class gives what the weighing of one gives.
  near(twoStreak(TWO_SCENES.row, [8, 0]).color, weighedStreak(TWO_SCENES.row).color)
})

test('the second largest motion of a tile spreads with its largest, a drawn spread left as it is', () => {
  // The tile (1, 0) moves 32 pixels along x — it covers the two tiles after it — and 16 along y.
  const ranges = { '1,0': [0, 0, 32, 0], 'drawn2,0': [0, 0, 5, 0] },
    seconds = { '1,0': [0, 16, 0, 0] }
  const spread = gatheredSeconds(ranges, seconds, [2, 0])
  assert.deepEqual(spread.range, [0, 0, 32, 0])
  near(spread.second!, [0, 16, 0, 0])
  const drawn = gatheredSeconds(ranges, seconds, [2, 0], true)
  assert.equal(drawn.range, undefined, 'the drawn ranges are not written again')
  near(drawn.second!, [0, 16, 0, 0])
})

test('the pixel keeps what the streak leaves of it, its alpha held to 0 or 1 within half a percent', () => {
  const { finished } = filterRun(NONE, NONE)
  near(finished([1, 1, 1, 1], 0.5, [0.25, 0, 0, 0.25]), [0.75, 0.5, 0.5, 0.75])
  const alphas = [0.999, 0.003, 0.5].map((a) => finished([1, 1, 1, a], 1, [0, 0, 0, 0])[3])
  assert.deepEqual(alphas, [1, 0, 0.5])
  near(finished([0.3, 0.2, 0.1, 1], 1, [0, 0, 0, 0]), [0.3, 0.2, 0.1, 1])
})

test('a pixel reads the image at its nearest texel, or from half its size by the mean of the 2 × 2', () => {
  const { colorAt, loads, tileTexelAt } = filterRun((x, y) => [x, y, 0, 1], NONE)
  assert.deepEqual(tileTexelAt([0.5, 0.5], [0, 0]), [2, 1], 'the tile of motion at the place')
  assert.deepEqual(tileTexelAt([0.5, 0.5], [-0.25, -0.25]), [1, 0], 'shifted by a quarter tile')
  assert.deepEqual(tileTexelAt([0, 0], [-0.25, -0.25]), [0, 0], 'held to the first tile')
  assert.deepEqual(tileTexelAt([1, 1], [0.25, 0.25]), [3, 1], 'and the last')
  assert.deepEqual(colorAt([10.5 / 64, 4.5 / 32], 0), [10, 4, 0, 1])
  assert.deepEqual(colorAt([10.5 / 64, 4.5 / 32], 0.49), [10, 4, 0, 1], 'a mip under a half: full')
  assert.equal(loads.sampled.length, 0)
  colorAt([10.5 / 64, 4.5 / 32], 0.5)
  // The texel of the half-size image is bilinear read at the centre of its four.
  near(loads.sampled[0], [11 / 64, 5 / 32])
  // The image may lie in the top-left of a larger texture: read at its own texels, held inside it.
  const larger = filterRun((x, y) => [x, y, 0, 1], NONE, [128, 64])
  larger.colorAt([1, 0.5], 0.5)
  near(larger.loads.sampled[0], [63 / 128, 17 / 64])
})

test('the streak follows the page’s frame, or the target’s own, whatever the rate', () => {
  const clock = createMotionBlurClock()
  assert.equal(clock.next(0, 30), 1, 'the first image has no frame before it')
  near([clock.next(1000 / 60, 30)], [2])
  near([clock.next(2000 / 60, 30)], [2])
  near([clock.next(2000 / 60 + 1000 / 30, 30)], [1], 4)
  const following = createMotionBlurClock()
  following.next(0, 0)
  // Without a target the streak follows a tenth of the way to each new frame, from 60 a second.
  const scales = Array.from({ length: 80 }, (_, i) => following.next((i + 1) * 20, 0))
  assert.ok(scales[0] < 1, 'a slower frame than the start: a shorter streak')
  assert.ok(Math.abs(scales.at(-1)! - 1) < 0.01, 'and it settles at 1')
})

test('a texel takes the motion of the nearest of the corners of its 3 × 3, a corner past the image the farthest', () => {
  const grid: number[][] = []
  const { nearestOffset } = shaderRun<{ nearestOffset: (pixel: Vec) => Vec }>(
    flattenShader(),
    ['nearestOffset'],
    { mb: blurUniform, depthTexture: { load: (at: Vec) => grid[at[1]]?.[at[0]] ?? 0 } },
  )
  // The depth is reversed: the nearer the larger. The corners of the texel (4, 4): upper left,
  // upper right, lower left, lower right.
  const at = (...depths: number[]) => {
    for (let y = 3; y <= 5; y++) grid[y] = [0, 0, 0, 0, 0.1, 0.1, 0.1]
    ;[grid[3][3], grid[3][5], grid[5][3], grid[5][5]] = depths
    return nearestOffset([4, 4])
  }
  assert.deepEqual(at(0.9, 0.2, 0.3, 0.4), [-1, -1])
  assert.deepEqual(at(0.2, 0.9, 0.3, 0.4), [1, -1])
  assert.deepEqual(at(0.2, 0.3, 0.9, 0.4), [-1, 1])
  assert.deepEqual(at(0.2, 0.3, 0.4, 0.9), [1, 1])
  assert.deepEqual(at(0.5, 0.5, 0.5, 0.5), [1, 1], 'a tie: the lower right')
  grid.length = 0 // the corner of the image: the three corners past it read zero
  grid[1] = [0, 0.3, 0.3]
  assert.deepEqual(nearestOffset([0, 0]), [1, 1])
})

test('the largest motions are spread by drawing past three tiles of streak, or when asked', () => {
  const spreads = (width: number, max = 5, scatter = false) => spreadsByDrawing(max, scatter, width)
  assert.deepEqual([spreads(1920), spreads(1921), spreads(1920, 5.1)], [false, true, true])
  assert.equal(spreads(64, 5, true), true)
})

test('an idle motion blur is no pass: nothing is drawn, nor compiled', async () => {
  const { gpu, effects, after } = await loaded()
  const { encoder, passes } = recorder(gpu)
  const blur = effect.motionBlur({ amount: 0 })
  assert.equal(after.ready(drawn([blur])), true)
  assert.equal(after.resolve(encoder, drawn([blur]), resolved, frameOf(gpu, 64, 32)), resolved)
  assert.deepEqual([passes.length, gpu.computePipelines.length, effects.bytes], [0, 0, 0])
})

test('the view sets the strength and the longest streak a pass draws with: its overrides revive or silence it', () => {
  const draws = (pass: ReturnType<typeof effect.motionBlur>, session: object) =>
    drawn([pass], session).length
  const idle = effect.motionBlur({ amount: 0 }),
    plain = effect.motionBlur()
  assert.deepEqual([draws(idle, {}), draws(plain, {})], [0, 1])
  // An override from 0 up replaces the pass's value, the scale then not applying; −1 leaves it.
  assert.equal(draws(idle, { motionBlurAmountOverride: 0.5 }), 1, 'a strength the view gives')
  assert.equal(draws(idle, { motionBlurScale: 50 }), 0, 'a scale of nothing is nothing')
  assert.equal(draws(plain, { motionBlurAmountOverride: 0 }), 0, 'silenced')
  assert.equal(draws(plain, { motionBlurMaxOverride: 0 }), 0, 'no longest streak')
  assert.equal(draws(plain, { motionBlurScale: 0 }), 0, 'no strength')
  assert.equal(draws(plain, { motionBlurScale: 0, motionBlurAmountOverride: 0.5 }), 1)
})

test('an image drawn below the largest size lies in the top-left of images of the largest', async () => {
  const { gpu, effects, chain, encoder, after } = await blurring({}, {})
  const frame = frameOf(gpu, 32, 16, {}, [64, 32])
  assert.notEqual(after.resolve(encoder, chain, resolved, frame), resolved)
  assert.equal(effects.bytes, motionBlurBytes(64, 32), 'the images are made at the largest size')
  const words = wordsOf(gpu.writes[0].buffer).slice(0, 4)
  assert.deepEqual([...words], [32, 16, 1 / 32, 1 / 16], 'the blur is of the size drawn')
})
