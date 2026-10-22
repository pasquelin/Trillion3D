import test from 'node:test'
import assert from 'node:assert/strict'
import { createSpans } from './spans.ts'
import { kernelShapeOf, screenProbeSources } from './screen/kernels.ts'
import { SCREEN_PROBE_LEVELS } from '../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import type { ScreenProbeOptions } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { createScreenProbeStore } from './screen/store.ts'
import { spHistory } from './screen/historyWgsl.ts'
import { spCommon } from './screen/commonWgsl.ts'
import { BLUE_NOISE_HALF_PERIOD } from '../../gpu/noise/blueNoiseWgsl.ts'
import {
  equalAreaDecode,
  equalAreaEncode,
  octWrapBorder,
} from '../../../../math/src/wgsl/octahedral.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { builtins } from '../../materials/texture/shaderRunBuiltins.fixture.ts'
import {
  reservedNames,
  topLevelNames,
  unbalanced,
  unresolvedNames,
} from '../../gpu/core/wgslNames.fixture.ts'

test('ranges are taken one after another, and a freed range is taken again first', () => {
  const spans = createSpans(100)
  assert.equal(spans.take(10), 0)
  assert.equal(spans.take(20), 10)
  assert.equal(spans.take(5), 30)
  spans.release(10, 20)
  assert.equal(spans.take(8), 10)
  assert.equal(spans.take(12), 18)
  assert.equal(spans.extent, 35)
  assert.equal(spans.take(1), 35, 'no freed range is left')
})

test('freed neighbours join, and a freed tail gives the used part back', () => {
  const spans = createSpans(64)
  spans.take(16)
  spans.take(16)
  spans.take(16)
  spans.release(0, 16)
  spans.release(16, 16)
  assert.equal(spans.take(32), 0)
  spans.release(32, 16)
  spans.release(0, 32)
  assert.equal(spans.extent, 0)
  assert.equal(spans.take(64), 0)
})

test('a table past its capacity answers nothing until it is grown', () => {
  const spans = createSpans(8)
  assert.equal(spans.take(8), 0)
  assert.equal(spans.take(1), undefined)
  spans.grown(9)
  assert.equal(spans.capacity, 16)
  assert.equal(spans.take(1), 8)
  assert.equal(spans.take(0), 9)
})

test('every screen-probe kernel is a module a device takes, at every level: its names declared, none reserved or twice, its bindings the layout holds', () => {
  const levels = SCREEN_PROBE_LEVELS.filter((level) => level !== 'off')
  assert.deepEqual(levels, ['low', 'high', 'ultra', 'cinematic'])
  for (const level of levels) {
    const shape = kernelShapeOf(screenProbeSettings({ screenProbes: level }))
    const sources = screenProbeSources(shape)
    assert.deepEqual(
      Object.keys(sources).filter((name) => name !== 'occlusion' && name !== 'temporal').length > 0,
      level !== 'low',
      `${level} makes the kernels over the probes only where it casts them`,
    )
    for (const [name, { code, entries, points }] of Object.entries(sources)) {
      const where = `${level} ${name}`
      assert.deepEqual(unresolvedNames(code), [], where)
      assert.deepEqual(reservedNames(code), [], where)
      assert.equal(unbalanced(code), '', where)
      const names = topLevelNames(code)
      assert.equal(new Set(names).size, names.length, where)
      const declared = [...code.matchAll(/@group\(0\)\s*@binding\((\d+)\)/g)].map((m) => +m[1])
      assert.deepEqual(
        declared.sort((a, b) => a - b),
        entries.map((entry) => entry.binding).sort((a, b) => a - b),
        where,
      )
      for (const point of points) assert.ok(code.includes(`fn ${point}(`), `${where} ${point}`)
    }
  }
})

test('every kernel reads the blue noise where the probes need a random number — the rays and their texels by the tile and the rays turn, the pixels by the frame — and keeps no hash', () => {
  const sources = screenProbeSources(kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra' })))
  const reads = {
    composite: ['blueNoiseVec2(tile,sp.mode.w)', 'blueNoiseVec2(tile,sp.mode.w+31u)'],
    spatial: ['blueNoiseVec2(tile,sp.mode.w)'],
    rays: ['blueNoiseVec2(spProbeTile(probePixels[index]),sp.mode.w)'],
    traceScreen: ['blueNoiseVec2(spProbeTile(probePixels[index]),sp.mode.w)'],
    traceField: ['blueNoiseVec2(spProbeTile(probePixels[index]),sp.mode.w)'],
    traceScene: ['blueNoiseVec2(spProbeTile(probePixels[index]),sp.mode.w)'],
    screenData: ['blueNoiseScalar(pixel,sp.size.w)'],
    occlusion: ['blueNoiseVec2(pixel,sp.size.w)'],
    temporal: [
      'blueNoiseScalar(id.xy,sp.size.w)',
      'blueNoiseScalar(pixel,sp.size.w)',
      'blueNoiseVec2(pixel,sp.size.w)',
      'ditherLight(',
    ],
  }
  for (const [name, { code }] of Object.entries(sources)) {
    for (const call of reads[name as keyof typeof reads] ?? [])
      assert.ok(code.includes(call), `${name} reads ${call}`)
    assert.ok(!/spNoise|rand3dPcg16\(vec3i\(vec2i\(coord/.test(code), `${name} holds no hash noise`)
  }
  assert.equal(BLUE_NOISE_HALF_PERIOD, 31, 'half of the frames largest index, rounded down')
})

test('the screen probes settings are read again at each image, and resolved only where a value moved', () => {
  const store = createScreenProbeStore()
  const options: ScreenProbeOptions = {}
  const first = store.read(options)
  assert.equal(store.read(options), first, 'nothing moved: the same settings')
  options.screenProbeQuality = 4
  const moved = store.read(options)
  assert.notEqual(moved, first)
  assert.equal(moved.tracingResolution, 16)
  assert.equal(store.read(options), moved)
  options.screenProbes = 'off'
  assert.equal(store.read(options).enabled, false)
})

test('the history word keeps the depth, the fast update, the frames and the occlusion as it packs them, and only none is none', () => {
  const longest = 10
  const meta = shaderRun<{
    spMetaOf: (w: number, frames: number, fast: number, occlusion: number) => number
    spMetaOcclusion: (word: number) => number
    spMetaDepth: (word: number) => number
    spMetaFast: (word: number) => number
    spMetaFrames: (word: number) => number
  }>(
    wgslModule(spHistory(7, 8)),
    ['spMetaOf', 'spMetaDepth', 'spMetaFast', 'spMetaFrames', 'spMetaOcclusion'],
    { sp: { counts: [longest, 0, 0, 0] } },
  )
  for (const frames of [0, 1, 4, 9.5, 10]) {
    const word = meta.spMetaOf(37.5, frames, 0, 1)
    assert.ok(Math.abs(meta.spMetaFrames(word) - frames) <= longest / 30 + 1e-9, `${frames} frames`)
    assert.equal(meta.spMetaDepth(word), 37.5, 'a half float holds this depth')
    assert.equal(meta.spMetaFast(word), 0)
  }
  assert.equal(meta.spMetaFrames(meta.spMetaOf(1, longest, 0, 1)), longest, 'the most is the most')
  assert.equal(meta.spMetaFrames(meta.spMetaOf(1, 3 * longest, 0, 1)), longest, 'held to it')
  assert.equal(
    meta.spMetaFast(meta.spMetaOf(1, 5, 0.001, 1)),
    1 / 15,
    'a fast update, however small, is one',
  )
  assert.equal(meta.spMetaFast(meta.spMetaOf(1, 5, 0.9, 1)), 14 / 15)
  assert.equal(meta.spMetaFast(meta.spMetaOf(1, 5, 2, 1)), 1, 'held to one')
  // The occlusion in eight bits, one at least: a lit pixel never reads as none; the fifteen frames of the largest setting fit four bits.
  assert.equal(meta.spMetaOcclusion(meta.spMetaOf(1, 5, 0, 1)), 1)
  assert.equal(meta.spMetaOcclusion(meta.spMetaOf(1, 5, 0, 0.5)), 128 / 255)
  assert.equal(meta.spMetaOcclusion(meta.spMetaOf(1, 5, 0, 0.0001)), 1 / 255, 'one at least')
  const fifteen = shaderRun<typeof meta>(
    wgslModule(spHistory(7, 8)),
    ['spMetaOf', 'spMetaFrames'],
    {
      sp: { counts: [15, 0, 0, 0] },
    },
  )
  assert.equal(
    fifteen.spMetaFrames(fifteen.spMetaOf(1, 14, 0, 1)),
    14,
    'fourteen of fifteen stay fourteen',
  )
  // A longest history past the four bits: the frames are coded over fifteen at most, and the code 15 is the longest, whatever it is.
  const wide = shaderRun<typeof meta>(wgslModule(spHistory(7, 8)), ['spMetaOf', 'spMetaFrames'], {
    sp: { counts: [40, 0, 0, 0] },
  })
  assert.equal(wide.spMetaFrames(wide.spMetaOf(1, 14, 0, 1)), 14)
  assert.equal(wide.spMetaFrames(wide.spMetaOf(1, 15, 0, 1)), 40, 'fifteen frames code the most')
  assert.equal(wide.spMetaFrames(wide.spMetaOf(1, 40, 0, 1)), 40)
})

test('the scene stage lists a ray by its texel alone, the disocclusion is read only where its flag is up, the occlusion search takes its slices and steps from the parameters', () => {
  const sources = screenProbeSources(kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra' })))
  for (const name of ['traceScreen', 'traceScene'] as const)
    assert.ok(/entries:array<u32>,\}/.test(sources[name].code), `${name} lists one word a ray`)
  assert.ok(
    !/bitcast<u32>\(seen\.distance\)/.test(sources.traceScreen.code),
    'no second word a ray',
  )
  assert.match(sources.screenData.code, /spFlag\(SP_FLAG_DISOCCLUSION\)&&spDisoccluded/)
  assert.match(sources.screenData.code, /spFlag\(SP_FLAG_DISOCCLUSION\)&&partial\[0\]\[10\]/)
  const search = sources.occlusion.code
  assert.ok(search.includes('u32(sp.occlusion.x)') && search.includes('u32(sp.occlusion.y)'))
  assert.ok(!/const SP_(SLICES|STEPS)/.test(search), 'no constant of the level')
})

test('the equal-area map of the sphere and its inverse agree, and the octahedron border wraps to a texel inside', () => {
  const map = shaderRun<{
    equalAreaDecode: (uv: number[]) => number[]
    equalAreaEncode: (direction: number[]) => number[]
    octWrapBorder: (texel: number[], resolution: number, border: number) => number[]
  }>(
    wgslModule(equalAreaDecode, equalAreaEncode, octWrapBorder),
    ['equalAreaDecode', 'equalAreaEncode', 'octWrapBorder'],
    {},
  )
  for (let i = 1; i < 16; i += 2) {
    for (let j = 1; j < 16; j += 2) {
      const uv = [i / 16, j / 16]
      const direction = map.equalAreaDecode(uv)
      assert.ok(Math.abs(Math.hypot(...direction) - 1) < 1e-5, 'a unit direction')
      const back = map.equalAreaEncode(direction)
      assert.ok(
        Math.abs(back[0] - uv[0]) < 1e-4 && Math.abs(back[1] - uv[1]) < 1e-4,
        `${uv} -> ${back}`,
      )
    }
  }
  // Eight texels and a border of one: a border texel is the texel of the map across the edge, the other axis
  // flipped, its coordinates inside the map (the border removed).
  for (const [texel, inside] of [
    [
      [0, 4],
      [0, 4],
    ],
    [
      [9, 2],
      [7, 6],
    ],
    [
      [4, 0],
      [4, 0],
    ],
    [
      [4, 9],
      [4, 7],
    ],
    [
      [3, 3],
      [2, 2],
    ],
  ] as const)
    assert.deepEqual(map.octWrapBorder([...texel], 10, 1), [...inside], `${texel}`)
})

test("a ray's end word keeps its distance to a few millionths, and whether it met a surface and whether that moves", () => {
  const word = shaderRun<{
    spHitWord: (distance: number, hit: boolean, moving: boolean) => number
    spHitDistance: (word: number) => number
    spHitIs: (word: number) => boolean
    spHitMoves: (word: number) => boolean
  }>(wgslModule(spCommon([4, 2])), ['spHitWord', 'spHitDistance', 'spHitIs', 'spHitMoves'], {})
  for (const [distance, hit, moving] of [
    [0, false, false],
    [12.5, true, false],
    [199.99, false, true],
    [3.3, true, true],
  ] as const) {
    const packed = word.spHitWord(distance, hit, moving)
    assert.ok(Math.abs(word.spHitDistance(packed) - distance) <= distance * 4e-7, `${distance}`)
    assert.deepEqual([word.spHitIs(packed), word.spHitMoves(packed)], [hit, moving])
  }
  assert.equal(
    word.spHitDistance(word.spHitWord(-5, true, true)),
    0,
    'a distance is never negative',
  )
})

test('a hit of the screen trace is kept by its gap in device depth, as the depth buffer holds it: a distance does not loosen the test a relative one would', () => {
  const half = (depth: number) => (builtins.pack2x16float([depth, 0]) as number) & 0xffff
  const gap = (slab: number[]) =>
    shaderRun<{ spDeviceGap: (word: number, expected: number[]) => number }>(
      wgslModule(spCommon([4, 2]), spHistory(7, 8)),
      ['spDeviceGap'],
      { reflectionView: { slab } },
    ).spDeviceGap
  // A perspective: the device depth is A + B / w, A the slab's y and B the projection's. At 10 m, the history holds 10 and the point is
  // expected at 10.5: the gap is B (1/10 - 1/10.5), whatever the A.
  const B = 0.1
  for (const A of [0, 0.2]) {
    const expected = [0, 0, (A + B / 10.5) * 10.5, 10.5]
    const found = gap([1, A, 0, 1])(half(10), expected)
    assert.ok(Math.abs(found - B * (1 / 10 - 1 / 10.5)) < 1e-6, `A ${A}: ${found}`)
  }
  // At 100 m a metre apart is a gap of a hundredth of the threshold; the relative test (a half to one and a half of an eighth of a
  // percent of the depth at a metre in a hundred) would have refused it.
  assert.ok(gap([1, 0, 0, 1])(half(100), [0, 0, B, 101]) < 0.005 / 100)
  // An orthographic view: the device depth is the linear one, the gap the plain difference.
  assert.ok(Math.abs(gap([1, 0, 0, 0])(half(10), [0, 0, 10.5, 1]) - 0.5) < 1e-6)
})
