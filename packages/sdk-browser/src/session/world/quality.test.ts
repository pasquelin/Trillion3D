import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QUALITY_LEVELS, QUALITY_PRESETS } from '../../../../sdk-core/src/runtime/qualityLevels.ts'
import { QUALITY_GROUPS } from '../../../../sdk-core/src/runtime/renderSettings.ts'
import { renderScaleBounds } from '../../frame/scale/renderScaleOption.ts'
import { renderScaleOf } from './quality.ts'
import { createWorldSettings } from './settings.ts'
import { quality, WORLD_SETTINGS } from './quality.fixture.ts'
import type { HardwareBenchmarkResult } from '../../../../sdk-core/src/runtime/hardwareBenchmark.ts'
import type { QualityBenchmark } from './benchmarkSource.ts'

test('by default the preset is auto and, with no benchmark kept, every setting resolves to its default', () => {
  const { settings, quality: q } = quality()
  assert.equal(q.preset, 'auto')
  assert.equal(q.hardware, null)
  for (const name of Object.keys(WORLD_SETTINGS) as (keyof typeof WORLD_SETTINGS)[])
    assert.equal(settings.get(name), WORLD_SETTINGS[name].default, name)
  assert.deepEqual(q.resolution, { mode: 'native', dynamic: true }, "R0's 'auto', 50 to 100 %")
})

test('a group the page set holds through every preset change', () => {
  const { settings, quality: q } = quality()
  q.preset = 'balanced'
  assert.equal(settings.get('pixelError'), 4)
  q.set('viewDistance', 'fine')
  q.preset = 'smooth'
  assert.equal(q.get('viewDistance'), 'fine')
  assert.equal(settings.get('pixelError'), 1, 'the page level, over the preset')
  assert.equal(settings.get('antialiasing'), 'off', 'the other groups follow the preset')
  assert.equal(q.preset, 'custom')
  q.set('viewDistance', 'preset')
  assert.equal(q.get('viewDistance'), 'smooth')
  assert.equal(settings.get('pixelError'), 8, 'given back, the group follows the preset')
  assert.equal(q.preset, 'smooth')
})

test('a page level of max writes the defaults over a coarser preset', () => {
  const { settings, quality: q } = quality({ preset: 'smooth', groups: { viewDistance: 'max' } })
  assert.equal(settings.get('pixelError'), WORLD_SETTINGS.pixelError.default)
  assert.equal(settings.get('antialiasing'), 'off')
  q.preset = 'max'
  assert.equal(q.preset, 'max', 'the page level is the preset level: not custom')
})

test('a value the page set by hand is not overwritten by a preset', () => {
  const { settings, quality: q } = quality()
  settings.set('pixelError', 2, 'page')
  q.preset = 'smooth'
  assert.equal(settings.get('pixelError'), 2)
  assert.equal(settings.source('pixelError'), 'page')
})

test('the resolution goes through the render scale: a mode fixed, or dynamic below it', () => {
  const { quality: q } = quality()
  q.resolution = { mode: 'fast' }
  assert.deepEqual(renderScaleBounds(renderScaleOf({ mode: 'fast' }), 3840 * 2160), {
    auto: false,
    min: 0.5,
    max: 0.5,
  })
  assert.deepEqual(q.resolution, { mode: 'fast', dynamic: false })
  q.resolution = { mode: 'native', dynamic: true }
  assert.equal(renderScaleOf(q.resolution), 'auto', 'the engine’s own dynamic resolution')
  q.resolution = { mode: 'fast', dynamic: true }
  assert.deepEqual(renderScaleOf(q.resolution), { min: 0.25, max: 0.5 })
  q.resolution = { mode: 'native', scale: 0.8 }
  assert.deepEqual(q.resolution, { mode: 'native', scale: 0.8, dynamic: false })
  assert.throws(() => (q.resolution = { mode: 'ultra' as never }), /QUALITY_RESOLUTION/)
})

test('levels() lists every group and level with the values they resolve to', () => {
  const { quality: q } = quality()
  const table = q.levels()
  assert.deepEqual(table.presets, ['smooth', 'balanced', 'fine', 'max', 'cinematic'])
  assert.equal(table.groups.viewDistance.fine.pixelError, 1)
  assert.equal(table.groups.viewDistance.max.pixelError, WORLD_SETTINGS.pixelError.default)
  assert.equal(table.groups.indirectLight.max.bounce, true)
  assert.equal(table.resolution.fast, 0.5)
})

test('an unknown preset, group or level is refused by name', () => {
  const { quality: q } = quality()
  assert.throws(() => (q.preset = 'ultra' as never), /QUALITY_PRESET/)
  assert.throws(() => q.set('sound' as never, 'max'), /QUALITY_GROUP/)
  assert.throws(() => q.set('shadows', 'ultra' as never), /QUALITY_LEVEL/)
})

test('every level writes settings of its own group that a preset may write, within bounds', () => {
  const settings = createWorldSettings()
  for (const group of QUALITY_GROUPS)
    for (const level of QUALITY_PRESETS)
      for (const [name, value] of Object.entries(QUALITY_LEVELS[group][level])) {
        const entry = WORLD_SETTINGS[name as keyof typeof WORLD_SETTINGS]
        assert.equal(entry?.group, group, `${group}.${level}: ${name}`)
        settings.set(name as keyof typeof WORLD_SETTINGS, value as never, 'quality')
      }
  for (const group of QUALITY_GROUPS)
    assert.deepEqual(QUALITY_LEVELS[group].max, {}, `${group}: max is today's defaults`)
})

test('the sky presets write the reference levels 0, 1 and 2 over the level-3 defaults', () => {
  const { settings, quality: q } = quality()
  q.preset = 'smooth'
  assert.equal(settings.get('atmosphereSamplesMax'), 16)
  assert.equal(settings.get('transmittanceSmallFormat'), true)
  assert.equal(settings.get('lightShafts'), false)
  assert.equal(settings.get('skyLightIntensityScale'), 0.8)
  q.preset = 'fine'
  assert.equal(settings.get('aerialSamplesPerSlice'), 2)
  assert.equal(settings.get('lightShafts'), true)
  q.preset = 'max'
  assert.equal(settings.get('atmosphereSamplesMax'), 128)
  assert.equal(settings.get('cloudViewSamplesMax'), 768, 'the clouds have no level')
})

test('renderSize is the size the last frame says it was drawn at, none before one', () => {
  const { frame, quality: q } = quality()
  assert.equal(q.renderSize, null)
  frame.last = { renderWidth: null, renderHeight: null }
  assert.equal(q.renderSize, null, 'an engine that does not say it')
  frame.last = { renderWidth: 1728, renderHeight: 1112 }
  assert.deepEqual(q.renderSize, { width: 1728, height: 1112 })
})

/** A result of graphics index `gpu`. */
const result = (gpu: number | null): HardwareBenchmarkResult => ({
  cpuIndex: 50,
  gpuIndex: gpu,
  cpuSteps: [50, 50],
  gpuSteps: [],
  workScale: 10,
  gpuWorkScale: 10,
  gpuMultiplier: 1,
})

/** A benchmark that keeps `kept` and answers `ran` when a run is asked, counting its runs. */
const benchmark = (kept: HardwareBenchmarkResult | null, ran = result(30)) => {
  const source: QualityBenchmark & { runs: number } = {
    runs: 0,
    saved: async () => kept,
    run: async () => {
      source.runs++
      return (kept = ran)
    },
  }
  return source
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test('a named preset runs nothing; the default, auto, with nothing kept runs once before the first image and draws it', async () => {
  for (const options of [{ preset: 'fine' as const }, undefined, { preset: 'auto' as const }]) {
    const source = benchmark(null, result(30))
    const { quality: q, decided } = quality(options, 'auto', source)
    assert.equal(source.runs, 0, 'never in the creating call')
    const named = options?.preset === 'fine'
    // The world opens its first session once the quality is decided: the first image is drawn at the final level.
    await decided()
    assert.equal(source.runs, named ? 0 : 1, JSON.stringify(options))
    assert.equal(q.get('edgeSmoothing'), named ? 'fine' : 'balanced')
  }
  const kept = benchmark(result(30))
  const { quality: q, decided } = quality(undefined, 'auto', kept)
  await decided()
  assert.equal(kept.runs, 0, 'a result kept for the adapter is read, not measured again')
  assert.equal(q.get('edgeSmoothing'), 'balanced', 'and drawn before the first image')
})

test('auto, named, draws the levels kept for this adapter, the resolution left to the display', async () => {
  const { settings, quality: q } = quality({ preset: 'auto' }, 'auto', benchmark(result(30)))
  assert.equal(q.get('viewDistance'), 'max', 'nothing waits for the kept result')
  await settle()
  assert.equal(q.preset, 'auto')
  assert.equal(q.get('edgeSmoothing'), 'balanced')
  assert.equal(settings.get('pixelError'), 4, 'the view distance’s balanced level')
  assert.deepEqual(
    q.resolution,
    { mode: 'native', dynamic: true },
    'the display-based default stays',
  )
  assert.equal(q.hardware && 'resolution' in q.hardware, false)
  q.set('viewDistance', 'balanced')
  assert.equal(q.preset, 'auto', 'a group at the benchmark’s level is no departure')
  q.set('viewDistance', 'max')
  assert.equal(q.preset, 'custom')
})

test('benchmark() runs once, keeps and draws: the preset becomes auto; a later preset wins', async () => {
  const source = benchmark(null, result(60))
  const { quality: q } = quality({ preset: 'smooth' }, 'auto', source)
  const found = await q.benchmark()
  assert.equal(source.runs, 1)
  assert.equal(found.groups?.textures, 'fine')
  assert.equal(q.preset, 'auto')
  assert.deepEqual(q.resolution, { mode: 'native', dynamic: true }, 'no resolution written')
  q.preset = 'max'
  assert.equal(q.get('textures'), 'max')
})

test('a result with no graphics index keeps every group at max under auto', async () => {
  const { quality: q } = quality({ preset: 'auto' }, 'auto', benchmark(result(null)))
  await settle()
  for (const group of QUALITY_GROUPS) assert.equal(q.get(group), 'max', group)
  assert.equal(q.hardware?.groups, null)
})
