// The reflections' settings as their one reader hands them to every image, the level the quality
// presets write, and the census a view that counts nothing makes none of.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createReflectionCensus } from './census.ts'
import { countedBy } from './censusCount.ts'
import { REFLECTION_CENSUS, REFLECTION_CENSUS_WORDS } from './censusWgsl.ts'
import { createReflectionSettingsReader } from './settings.ts'
import { QUALITY_LEVELS } from '../../../../sdk-core/src/runtime/qualityLevels.ts'
import { REFLECTION_RULES } from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

test('a view that counts nothing makes no buffer and reads nothing back', () => {
  const { device } = fakeDevice()
  const census = createReflectionCensus(device, false)
  assert.equal(census.buffer, undefined)
  census.copy(device.createCommandEncoder(), 1)
  assert.equal(census.metrics(), null)
  census.dispose()
})

test('a census counts the rays of the screen stage whatever marched the scene’s, and how they ended only where the field did', () => {
  const words = new Uint32Array(REFLECTION_CENSUS_WORDS)
  words[REFLECTION_CENSUS.screen] = 7
  words[REFLECTION_CENSUS.left] = 3
  words[REFLECTION_CENSUS.fates + 1] = 2
  words[REFLECTION_CENSUS.work] = 5
  const marched = countedBy(words, 1, 9, true)
  assert.deepEqual([marched.rays, marched.screenRays, marched.sceneRays], [10, 7, 3])
  assert.equal(marched.sceneEnded?.hit, 2)
  assert.equal(marched.sceneWork?.[0], 5)
  const triangles = countedBy(words, 1, 9, false)
  assert.deepEqual([triangles.rays, triangles.screenRays, triangles.sceneRays], [10, 7, 3])
  assert.deepEqual([triangles.sceneEnded, triangles.sceneWork], [null, null])
})

test('the one reader of the settings hands the last image’s back while none moved, and follows the reflections’ and the screen probes’', () => {
  const read = createReflectionSettingsReader()
  const context: Record<string, unknown> = {}
  const first = read(context)
  assert.equal(read(context), first, 'nothing moved: the same object')
  context.reflectionScreenSteps = 20
  const steps = read(context)
  assert.notEqual(steps, first)
  assert.equal(steps.screenSteps, 20)
  assert.equal(steps.marchesField, true, 'rays are marched through the field')
  context.screenProbeSceneTraces = false
  const off = read(context)
  assert.equal(off.sceneTraces, false, 'the switch the screen probes share')
  assert.equal(off.marchesField, false, 'with the scene trace off, nothing is marched')
  context.screenProbeSceneTraces = true
  context.reflectionQuality = 'off'
  assert.equal(read(context).marchesField, false, 'nor where the level traces no ray')
  assert.equal(
    read(context).enabled,
    false,
    'the level off is not enabled: the frame stages no trace',
  )
  context.reflectionQuality = 'high'
  assert.equal(read(context).enabled, true)
})

test('the quality presets write the reflections’ level, the reference’s rows: none for the two lowest, high, then the default', () => {
  const levels = QUALITY_LEVELS.indirectLight
  assert.deepEqual(
    (['smooth', 'balanced', 'fine', 'max'] as const).map(
      (preset) => levels[preset].reflectionQuality,
    ),
    ['off', 'off', 'high', undefined],
  )
  // The foliage pixels’ bar is the level’s row, never a preset’s write.
  assert.deepEqual(
    (['smooth', 'balanced', 'fine', 'max', 'cinematic'] as const).map(
      (preset) => 'reflectionMaxRoughnessToTraceForFoliage' in levels[preset],
    ),
    [false, false, false, false, false],
  )
})

test('the scene’s water asks for the front layer at every level that traces, with its own block and denoising', () => {
  const read = createReflectionSettingsReader()
  const context: Record<string, unknown> = { reflectionQuality: 'high' }
  assert.equal(read(context).frontLayer, false, 'the level high traces no front layer')
  const water = {
    block: [2, 1] as [number, number],
    reconstruction: true,
    temporal: false,
    bilateral: true,
    sceneTraces: false,
    distantTraces: false,
  }
  const asked = read(context, water)
  assert.equal(asked.frontLayer, true)
  assert.deepEqual(
    [asked.frontBlock, asked.frontReconstruction, asked.frontTemporal, asked.frontBilateral],
    [[2, 1], true, false, true],
  )
  assert.equal(asked.frontSceneTraces, false, 'the screen technique marches no scene')
  assert.equal(asked.sceneTraces, true, 'the opaque trace keeps its own')
  assert.equal(asked.block, 2, 'the level high’s block, its own')
  assert.equal(read(context, water), asked, 'nothing moved: the same object')
  context.reflectionQuality = 'off'
  assert.equal(read(context, water).frontLayer, false, 'no ray at the level off')
  context.reflectionQuality = 'ultra'
  const plain = read(context)
  assert.deepEqual(
    [plain.frontBlock, plain.frontReconstruction, plain.frontTemporal, plain.frontSceneTraces],
    [[1, 1], true, true, true],
    'without water the front layer is the opaque trace’s',
  )
})

test('the rays through the scene’s triangles are on by default, their biases the reference’s in metres, and follow their settings', () => {
  const read = createReflectionSettingsReader()
  const context: Record<string, unknown> = {}
  const first = read(context)
  assert.equal(first.hardwareTraces, true)
  assert.deepEqual(
    [first.hardwareBias, first.hardwareNormalBias, first.hardwarePullbackBias],
    [0.001, 0.001, 0.08],
  )
  context.reflectionHardwareRayTracing = false
  context.hardwareRayTracingPullbackBias = 0.16
  const changed = read(context)
  assert.equal(changed.hardwareTraces, false)
  assert.equal(changed.hardwarePullbackBias, 0.16)
})

test('the roughness fade is held between a thousandth and one, as the width a roughness is divided by', () => {
  const read = createReflectionSettingsReader()
  const context: Record<string, unknown> = {}
  assert.equal(read(context).roughnessFade, 0.1)
  context.reflectionRoughnessFadeLength = 0.00001
  assert.equal(read(context).roughnessFade, 0.001)
  context.reflectionRoughnessFadeLength = 7
  assert.equal(read(context).roughnessFade, 1)
  context.reflectionRoughnessFadeLength = 0.5
  assert.equal(read(context).roughnessFade, 0.5)
})

test('the transparents’ front layer is traced for the opaque pass’s block: the quality scale and the checkerboard reach it', () => {
  const read = createReflectionSettingsReader()
  const context: Record<string, unknown> = {
    reflectionFrontLayer: true,
    reflectionQualityScale: 0.25,
    reflectionDownsampleCheckerboard: true,
  }
  const settings = read(context)
  assert.deepEqual(
    [settings.block, settings.blockY],
    [2, 1],
    'the opaque trace’s block, doubled and kept one high',
  )
  assert.equal(settings.frontLayer, true)
  assert.deepEqual(settings.frontBlock, [2, 1], 'the opaque pass’s factor, the checkerboard’s row')
})

test('the hardware biases of the reflections carry their unit, and the pullback is the screen probes’ shared one', () => {
  const rules = REFLECTION_RULES as unknown as Record<string, { takes?: string }>
  assert.match(rules.reflectionHardwareRayTracingBias.takes ?? '', /centimetres/)
  assert.match(rules.reflectionHardwareRayTracingNormalBias.takes ?? '', /centimetres/)
  assert.match(
    rules.reflectionHardwareRayTracingFirstPersonMinimumHitDistance.takes ?? '',
    /centimetres/,
  )
  assert.equal('reflectionHardwareRayTracingPullbackBias' in REFLECTION_RULES, false)
})

test('the roughness past which the screen probes read the rough specular of a foliage pixel no more is the reflections’ level’s row, a probes’ setting replacing it, the default row where the reflections are off', () => {
  const read = createReflectionSettingsReader()
  const context: Record<string, unknown> = {}
  const bar = () => read(context).maxRoughnessEvaluateFoliage
  assert.equal(bar(), 0.8, 'ultra')
  context.reflectionQuality = 'high'
  assert.equal(bar(), 0.4, 'high')
  context.reflectionQuality = 'cinematic'
  assert.equal(bar(), 0.8, 'cinematic')
  context.reflectionQuality = 'off'
  assert.equal(bar(), 0.8, 'off: no row of the reference sets it, its default stands')
  context.reflectionQuality = 'high'
  context.screenProbeMaxRoughnessToEvaluateRoughSpecularForFoliage = 0.6
  assert.equal(bar(), 0.6, 'the setting over the row')
  context.screenProbeMaxRoughnessToEvaluateRoughSpecularForFoliage = 0
  assert.equal(bar(), 0, 'zero is a bar, not the level’s row')
})

test('a foliage pixel’s roughness bar is the level’s row, a setting a host names replacing it, zero at the level off', () => {
  const read = createReflectionSettingsReader()
  const context: Record<string, unknown> = {}
  const bars = () => [read(context).maxRoughness, read(context).maxRoughnessFoliage]
  assert.deepEqual(bars(), [0.4, 0.4], 'ultra')
  context.reflectionQuality = 'high'
  assert.deepEqual(bars(), [0.4, 0.2], 'high')
  context.reflectionQuality = 'cinematic'
  assert.deepEqual(bars(), [0.4, 0.4], 'cinematic')
  context.reflectionMaxRoughnessToTraceForFoliage = 0.3
  assert.deepEqual(bars(), [0.4, 0.3], 'the setting over the row')
  context.reflectionMaxRoughnessToTraceForFoliage = 0
  assert.equal(bars()[1], 0, 'zero is a bar, not the level’s row')
  context.reflectionMaxRoughnessToTraceForFoliage = -1
  assert.equal(bars()[1], 0.4, 'the default hands the row back')
  context.reflectionQuality = 'off'
  assert.equal(read(context).maxRoughnessFoliage, 0)
})
