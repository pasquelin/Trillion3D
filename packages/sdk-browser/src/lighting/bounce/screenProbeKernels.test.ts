import test from 'node:test'
import { NO_SCENE_MASKS } from '../rays/sceneTrace/sceneMaskPrograms.ts'
import assert from 'node:assert/strict'
import { kernelShapeOf, screenProbeSources } from './screen/kernels.ts'
import { SCREEN_PROBE_LEVELS } from '../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import type { ScreenProbeOptions } from '../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { createScreenProbeStore } from './screen/store.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { TRACE_SCENE_HIT } from './screen/traceSceneWgsl.ts'
import { BLUE_NOISE_HALF_PERIOD } from '../../gpu/noise/blueNoiseWgsl.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'

test('every screen-probe kernel is a module a device takes, at every level: its names declared, none reserved or twice, its bindings the layout holds', () => {
  const levels = SCREEN_PROBE_LEVELS.filter((level) => level !== 'off')
  assert.deepEqual(levels, ['high', 'ultra', 'cinematic'])
  for (const level of levels)
    for (const screenProbeHeightFogOnGI of [false, true]) {
      const shape = kernelShapeOf(
        screenProbeSettings({ screenProbes: level, screenProbeHeightFogOnGI }),
      )
      const sources = screenProbeSources(shape, undefined, undefined, undefined, undefined, false)
      for (const [name, { code, entries, points }] of Object.entries(sources)) {
        const where = `${level} ${name}${screenProbeHeightFogOnGI ? ' with the fog' : ''}`
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

test('every kernel reads the blue noise where the probes need a random number — the rays and their texels by the tile and the rays turn, the pixels by the frame — and keeps no hash but the dither of the 11-11-10 targets (a hash of the texel and the frame; the spatial filter’s blue noise of the pass)', () => {
  const sources = {
    ...screenProbeSources(kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra' })), undefined, undefined, undefined, undefined, false),
    // The kernels the temporal filter of the probes and the levels of the filtered radiance add.
    ...Object.fromEntries(
      Object.entries(
        screenProbeSources(
          kernelShapeOf(
            screenProbeSettings({
              screenProbes: 'ultra',
              screenProbeTemporalFilterProbes: true,
              screenProbeGatherNumMips: 2,
            }),
          ), undefined, undefined, undefined, undefined, false,
),
      ).filter(([name]) => ['probeFilter', 'fixup', 'mip1'].includes(name)),
    ),
  }
  const reads = {
    composite: [
      'blueNoiseVec2(tile,sp.mode.w)',
      'blueNoiseVec2(tile,sp.mode.w+31u)',
      'rand3dPcg16(vec3i(vec2i(texel),i32(sp.size.w%SP_TILE_JITTERS)+salt))',
    ],
    convert: ['rand3dPcg16(vec3i(vec2i(texel),i32(sp.size.w%SP_TILE_JITTERS)+salt))'],
    probeFilter: ['spTargetDither(id.xy,10)'],
    fixup: ['spTargetDither(id.xy,0)'],
    mip1: ['spTargetDither(id.xy,i32(SP_MIP_LEVEL)+13)'],
    spatial: [
      'blueNoiseVec2(tile,sp.mode.w)',
      'blueNoiseScalar(id.xy,sp.size.w%SP_TILE_JITTERS+spatialPass.x+11u)',
    ],
    rays: ['blueNoiseVec2(spProbeTile(index,probePixels[index]),sp.mode.w)'],
    traceScreen: [
      'blueNoiseVec2(spProbeTile(index,probePixels[index]),sp.mode.w)',
      'f32(sp.frames.x%SP_TILE_JITTERS)',
    ],
    traceField: ['blueNoiseVec2(spProbeTile(index,probePixels[index]),sp.mode.w)'],
    traceScene: ['blueNoiseVec2(spProbeTile(index,probePixels[index]),sp.mode.w)'],
    screenData: ['blueNoiseScalar(pixel,sp.frames.z)'],
    occlusion: ['blueNoiseVec2(pixel,sp.frames.x)', 'fourRooksJitter(cell,sp.frames.x)'],
    integrate: [
      'blueNoiseScalar(pixel,sp.frames.y)',
      'blueNoiseScalar(cell,sp.size.w%8u)',
      'blueNoiseVec2(pixel,sp.frames.y)',
    ],
    temporal: [
      'blueNoiseScalar(id.xy,sp.frames.z)',
      'blueNoiseScalar(id.xy,sp.frames.x)',
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

test('the traced scene kernel is kept by the rays a side of a probe, the samples of a tile and the fog on the rays: an option that changes none keeps it, one that does makes another', () => {
  const { device } = fakeDevice()
  const store = createScreenProbeStore()
  const kernelOf = (options: Parameters<typeof screenProbeSettings>[0]) =>
    store.tracedMakerFor(device, screenProbeSettings(options), WORD_LIGHT_FORMAT)(NO_SCENE_MASKS)
  const kernel = kernelOf({ screenProbes: 'ultra' })
  assert.equal(
    kernelOf({ screenProbes: 'ultra', screenProbeGatherNumMips: 2 }),
    kernel,
    'the levels of the gather',
  )
  assert.notEqual(
    kernelOf({ screenProbes: 'ultra', screenProbeQuality: 4 }),
    kernel,
    'sixteen rays a side',
  )
  assert.notEqual(
    kernelOf({ screenProbes: 'ultra', screenProbeHeightFogOnGI: true }),
    kernel,
    'the fog on the rays',
  )
})

test('the scene stage of the screen probes is built over the reflection group it reads, and lays the fog only where the option is on: no other kernel is made for it', () => {
  const sources = (screenProbeHeightFogOnGI: boolean) =>
    screenProbeSources(
      kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra', screenProbeHeightFogOnGI })), undefined, undefined, undefined, undefined, false,
)
  for (const on of [false, true]) {
    const all = sources(on)
    assert.equal(all.traceScene?.scene, true, 'the scene stage reads the reduced reflection group')
    assert.equal(all.traceScreen?.scene, undefined, 'the screen stage reads the whole')
    assert.equal(all.traceScene?.code.includes('reflectionFogged'), on)
  }
  assert.deepEqual(
    Object.keys(sources(true)),
    Object.keys(sources(false)),
    'the fog is laid in the stages that write the light, by no pass of its own',
  )
  assert.notEqual(sources(false).traceScene?.key, sources(true).traceScene?.key)
  assert.equal(sources(false).traceScreen?.key, sources(true).traceScreen?.key)
})

test('a device that refused the kernels is the store’s reason only while it is the owner: a new owner starts clean, and a late refusal of the old one says nothing', async () => {
  const settings = screenProbeSettings({ screenProbes: 'ultra' })
  const settled = () => new Promise((resolve) => setTimeout(resolve, 0))
  const store = createScreenProbeStore()
  const refusing = fakeDevice({ failCompile: true }).device
  assert.equal(store.kernelsFor(refusing, settings, WORD_LIGHT_FORMAT), undefined)
  await settled()
  assert.ok(store.reason, 'the owner’s refusal is the reason')
  const next = fakeDevice().device
  store.kernelsFor(next, settings, WORD_LIGHT_FORMAT)
  assert.equal(store.reason, null, 'the new owner starts without the old one’s reason')
  await settled()
  assert.equal(store.reason, null, 'the new owner compiled')
  const late = createScreenProbeStore()
  late.kernelsFor(fakeDevice({ failCompile: true }).device, settings, WORD_LIGHT_FORMAT)
  late.kernelsFor(fakeDevice().device, settings, WORD_LIGHT_FORMAT)
  await settled()
  assert.equal(late.reason, null, 'a refusal of a device that is no longer the owner is ignored')
})

test('the sources the store wrote for a device are written again for the next one: its dispatch width is the new device’s', async () => {
  const settings = screenProbeSettings({ screenProbes: 'ultra' })
  const store = createScreenProbeStore()
  const first = fakeDevice({
    failCompile: true,
    limits: { maxComputeWorkgroupsPerDimension: 1000 },
  })
  store.kernelsFor(first.device, settings, WORD_LIGHT_FORMAT)
  const second = fakeDevice({ limits: { maxComputeWorkgroupsPerDimension: 2000 } })
  store.kernelsFor(second.device, settings, WORD_LIGHT_FORMAT)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const widths = second.computePipelines.map((pipeline) => pipeline.compute.constants?.GROUP_WIDTH)
  assert.ok(widths.includes(2000), 'built at the second device’s width')
  assert.ok(!widths.includes(1000), 'none at the first one’s')
})

test('the scene stage lists a ray by its texel alone, the disocclusion is read only where its flag is up, the occlusion search takes its slices and steps from the parameters', () => {
  const sources = screenProbeSources(kernelShapeOf(screenProbeSettings({ screenProbes: 'ultra' })), undefined, undefined, undefined, undefined, false)
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
