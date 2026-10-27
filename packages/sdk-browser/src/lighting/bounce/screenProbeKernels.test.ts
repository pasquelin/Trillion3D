import test from 'node:test'
import assert from 'node:assert/strict'
import { kernelShapeOf, screenProbeSources } from './screen/kernels.ts'
import { SCREEN_PROBE_LEVELS } from '../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import type { ScreenProbeOptions } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { createScreenProbeStore } from './screen/store.ts'
import { SP_BENT_WGSL, spHistory } from './screen/historyWgsl.ts'
import { TRACE_SCENE_HIT } from './screen/traceSceneWgsl.ts'
import { BLUE_NOISE_HALF_PERIOD } from '../../gpu/noise/blueNoiseWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { octCellsDecode, octCellsEncode } from '../../../../math/src/wgsl/octahedral.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'

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
      assertProgramAssembles(code, undefined, where)
      const declared = [...code.matchAll(/@group\(0\)\s*@binding\((\d+)\)/g)].map((m) => +m[1])
      const bound = entries.map((entry) => entry.binding)
      assert.deepEqual(
        bound.filter((binding) => !declared.includes(binding)),
        [],
        `${where}: a binding the layout holds and the code does not declare`,
      )
      // The surface cache's layers a hit does not read are declared by its library and bound by no layout.
      const unread = (binding: number) =>
        binding >= TRACE_SCENE_HIT.cards + 2 && binding <= TRACE_SCENE_HIT.cards + 6
      assert.deepEqual(
        declared.filter((binding) => !bound.includes(binding) && !unread(binding)),
        [],
        `${where}: a binding the code declares and the layout does not hold`,
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
  const options: { -readonly [K in keyof ScreenProbeOptions]: ScreenProbeOptions[K] } = {}
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

test('the history word keeps the depth, the fast update and the frames as it packs them, and only none is none', () => {
  const longest = 10
  const up = [0, 0, 1]
  const meta = shaderRun<{
    spMetaOf: (w: number, frames: number, fast: number, normal: number[]) => number
    spMetaDepth: (word: number) => number
    spMetaFast: (word: number) => number
    spMetaFrames: (word: number) => number
  }>(wgslModule(spHistory(7, 8)), ['spMetaOf', 'spMetaDepth', 'spMetaFast', 'spMetaFrames'], {
    sp: { counts: [longest, 0, 0, 0] },
  })
  for (const frames of [0, 1, 4, 9.5, 10]) {
    const word = meta.spMetaOf(37.5, frames, 0, up)
    assert.ok(Math.abs(meta.spMetaFrames(word) - frames) <= longest / 30 + 1e-9, `${frames} frames`)
    assert.equal(meta.spMetaDepth(word), 37.5, 'a half float holds this depth')
    assert.equal(meta.spMetaFast(word), 0)
  }
  assert.equal(meta.spMetaFrames(meta.spMetaOf(1, longest, 0, up)), longest, 'the most is the most')
  assert.equal(meta.spMetaFrames(meta.spMetaOf(1, 3 * longest, 0, up)), longest, 'held to it')
  assert.equal(
    meta.spMetaFast(meta.spMetaOf(1, 5, 0.001, up)),
    1 / 15,
    'a fast update, however small, is one',
  )
  assert.equal(meta.spMetaFast(meta.spMetaOf(1, 5, 0.9, up)), 14 / 15)
  assert.equal(meta.spMetaFast(meta.spMetaOf(1, 5, 2, up)), 1, 'held to one')
  const fifteen = shaderRun<typeof meta>(
    wgslModule(spHistory(7, 8)),
    ['spMetaOf', 'spMetaFrames'],
    {
      sp: { counts: [15, 0, 0, 0] },
    },
  )
  assert.equal(
    fifteen.spMetaFrames(fifteen.spMetaOf(1, 14, 0, up)),
    14,
    'fourteen of fifteen stay fourteen',
  )
  // A longest history past the four bits: the frames are coded over fifteen at most, and the code 15 is the longest, whatever it is.
  const wide = shaderRun<typeof meta>(wgslModule(spHistory(7, 8)), ['spMetaOf', 'spMetaFrames'], {
    sp: { counts: [40, 0, 0, 0] },
  })
  assert.equal(wide.spMetaFrames(wide.spMetaOf(1, 14, 0, up)), 14)
  assert.equal(wide.spMetaFrames(wide.spMetaOf(1, 15, 0, up)), 40, 'fifteen frames code the most')
  assert.equal(wide.spMetaFrames(wide.spMetaOf(1, 40, 0, up)), 40)
})

test('the history word keeps the surface’s normal in two cells of four bits, to the grid’s step', () => {
  const meta = shaderRun<{
    spMetaOf: (w: number, frames: number, fast: number, normal: number[]) => number
    spMetaNormal: (word: number) => number[]
    spMetaDepth: (word: number) => number
  }>(wgslModule(spHistory(7, 8)), ['spMetaOf', 'spMetaNormal', 'spMetaDepth'], {
    sp: { counts: [10, 0, 0, 0] },
  })
  for (const v of [
    [0, 0, 1],
    [0, 0, -1],
    [1, 0, 0],
    [0.3, -0.5, 0.8],
    [-1, -1, -1],
    [0.2, 0.9, -0.1],
  ]) {
    const length = Math.hypot(...v)
    const normal = v.map((x) => x / length)
    const word = meta.spMetaOf(12.5, 3, 0.5, normal)
    const kept = meta.spMetaNormal(word)
    // The cells are its square point rounded on the grid, not the nearest of all on the sphere: the
    // worst kept is the diagonal's, 0.9623 of a unit (its point halfway between two cells).
    assert.ok(normal.reduce((sum, x, i) => sum + x * kept[i], 0) > 0.962, `the normal ${v}`)
    assert.equal(meta.spMetaDepth(word), 12.5, 'the normal leaves the depth alone')
  }
})

test('the octahedral cells of a normal decode back to the cell, and to the same normal where the cell shares its point with another', () => {
  const codec = shaderRun<{
    octCellsEncode: (n: number[], bits: number) => number[]
    octCellsDecode: (cells: number[], bits: number) => number[]
  }>(
    `${wgslModule(octCellsEncode)}\n${wgslModule(octCellsDecode)}`,
    ['octCellsEncode', 'octCellsDecode'],
    {},
  )
  for (const bits of [4, 8])
    for (const x of [0, 1, 5, 7, 8, 9, (1 << bits) - 2, (1 << bits) - 1])
      for (const y of [0, 2, 6, 7, 8, 11, (1 << bits) - 1]) {
        const normal = codec.octCellsDecode([x, y], bits)
        const back = codec.octCellsEncode(normal, bits)
        if (normal[2] > 0.01) assert.deepEqual(back, [x, y], `the cell ${x}, ${y} of ${bits} bits`)
        const again = codec.octCellsDecode(back, bits)
        for (let k = 0; k < 3; k++)
          assert.ok(
            Math.abs(again[k] - normal[k]) < 1e-4,
            `the normal of ${x}, ${y} of ${bits} bits`,
          )
      }
})

test('the bent normal word keeps the open sky’s direction and its amount, and a word of zero is none', () => {
  const bent = shaderRun<{
    spBentPack: (v: number[]) => number
    spBentUnpack: (word: number) => number[]
  }>(wgslModule(SP_BENT_WGSL), ['spBentPack', 'spBentUnpack'], {})
  for (const v of [
    [0, 1, 0],
    [0.3, 0.4, -0.5],
    [-0.1, -0.2, 0.05],
  ]) {
    const amount = Math.hypot(...v)
    const [x, y, z, w] = bent.spBentUnpack(bent.spBentPack(v))
    assert.ok(Math.abs(w - amount) < 2e-3, `the amount ${amount}`)
    for (const [got, want] of [
      [x, v[0] / amount],
      [y, v[1] / amount],
      [z, v[2] / amount],
    ])
      assert.ok(Math.abs(got - want) < 5e-3, `the direction ${v}`)
  }
})

test('the scene stage lists a ray by its texel alone, the disocclusion is read only where its flag is up, the occlusion search takes its slices and steps from the parameters', () => {
  const sources = screenProbeSources(kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra' })))
  for (const name of ['traceScreen', 'traceScene'] as const)
    assert.ok(/entries:array<u32>,\}/.test(sources[name]!.code), `${name} lists one word a ray`)
  assert.ok(
    !/bitcast<u32>\(seen\.distance\)/.test(sources.traceScreen!.code),
    'no second word a ray',
  )
  assert.match(sources.screenData!.code, /spFlag\(SP_FLAG_DISOCCLUSION\)&&spDisoccluded/)
  assert.match(sources.screenData!.code, /spFlag\(SP_FLAG_DISOCCLUSION\)&&partial\[0\]\[10\]/)
  const search = sources.occlusion.code
  assert.ok(search.includes('u32(sp.occlusion.x)') && search.includes('u32(sp.occlusion.y)'))
  assert.ok(!/const SP_(SLICES|STEPS)/.test(search), 'no constant of the level')
})
