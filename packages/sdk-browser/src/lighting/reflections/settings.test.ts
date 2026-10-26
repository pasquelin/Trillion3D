// The reflections' settings as their one reader hands them to every image, the level the quality
// presets write, and the census a view that counts nothing makes none of.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createReflectionCensus } from './census.ts'
import { createReflectionSettingsReader } from './settings.ts'
import { QUALITY_LEVELS } from '../../../../sdk-core/src/runtime/qualityLevels.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'

test('a view that counts nothing makes no buffer and reads nothing back', () => {
  const { device } = fakeDevice()
  const census = createReflectionCensus(device, false)
  assert.equal(census.buffer, undefined)
  census.copy(device.createCommandEncoder(), 1)
  assert.equal(census.metrics(), null)
  census.dispose()
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
})

test('the quality presets write the reflections’ level, the reference’s rows: none for the two lowest, high, then the default', () => {
  const levels = QUALITY_LEVELS.indirectLight
  assert.deepEqual(
    (['smooth', 'balanced', 'fine', 'max'] as const).map(
      (preset) => levels[preset].reflectionQuality,
    ),
    ['off', 'off', 'high', undefined],
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
