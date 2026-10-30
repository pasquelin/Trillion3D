// The reflections' radiance cache: the settings it resolves to, the program of its two kernels, and the probe its stochastic read draws.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { createReflectionSettingsReader } from '../settings.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'
import { radianceCacheProgram } from './wgsl.ts'

const PROGRAM = radianceCacheProgram(WORD_LIGHT_FORMAT)

test('the cache is off by default, with the reference’s numbers, and on only where the screen probes keep a cache', () => {
  const read = createReflectionSettingsReader()
  const off = read({})
  assert.equal(off.radianceCache, false)
  assert.deepEqual(
    [
      off.radianceCacheMinRoughness,
      off.radianceCacheMaxRoughness,
      off.radianceCacheFade,
      off.radianceCacheRadiusScale,
    ],
    [0.2, 0.35, 0.05, 10],
  )
  assert.deepEqual([off.radianceCacheMaxDistance, off.radianceCacheMinDistance], [50, 10])
  assert.equal(off.radianceCacheStochastic, true)
  assert.equal(read({ reflectionRadianceCache: true }).radianceCache, true)
  assert.equal(
    read({ reflectionRadianceCache: true, screenProbeRadianceCache: false }).radianceCache,
    false,
  )
})

test('the cache replaces the far trace of the opaque rays, and the numbers are held as the reference holds them', () => {
  const read = createReflectionSettingsReader()
  assert.equal(read({}).distantTraces, true)
  const on = read({
    reflectionRadianceCache: true,
    reflectionRadianceCacheMinRoughness: 0.5,
    reflectionRadianceCacheMaxRoughness: 0.3,
    reflectionRadianceCacheMaxTraceDistance: 1e9,
    reflectionRadianceCacheMinTraceDistance: 1e9,
  })
  assert.equal(on.distantTraces, false)
  assert.equal(on.radianceCacheMaxRoughness, 0.5, 'not under the roughness it begins at')
  assert.equal(on.radianceCacheMaxDistance, 200, 'not past the view’s longest ray')
  assert.equal(on.radianceCacheMinDistance, 200, 'not past the longest')
})

test('the program has the two kernels and no backtick', () => {
  for (const entry of ['fn cacheLimits(', 'fn cacheReads('])
    assert.ok(PROGRAM.includes(entry), entry)
  const code = PROGRAM.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.ok(!code.includes('`'))
})

test('the stochastic read keeps the one probe the weights name at a half, and gives it the whole weight', () => {
  const cacheNow = (alpha: number[]) => ({ corner: [1, 2, 3, 4, 5, 6, 7, 8], alpha })
  const pick = (alpha: number[], random: number) => {
    const now = cacheNow(alpha)
    shaderRun<{ reflectionStochasticProbe: (r: number) => void }>(
      PROGRAM,
      ['reflectionStochasticProbe'],
      {
        cacheNow: now,
      },
    ).reflectionStochasticProbe(random)
    return now
  }
  const middle = pick([0.5, 0.5, 0.5], 0.5)
  assert.deepEqual(
    middle.corner,
    [0, 0, 0, 4, 0, 0, 0, 0],
    'eight equal shares reach a half at the fourth corner',
  )
  assert.deepEqual(middle.alpha, [1, 1, 0])
  assert.deepEqual(
    pick([0, 0, 0], 0.5).corner,
    [1, 0, 0, 0, 0, 0, 0, 0],
    'a point on a probe takes it',
  )
})

test('the reads kernel copies the screen probes’ parameters to the thread before it reads the cache', () => {
  assert.match(PROGRAM, /var<uniform> spBase:ScreenProbeParams/)
  assert.match(PROGRAM, /var<private> sp:ScreenProbeParams/)
  assert.match(PROGRAM, /fn cacheReadsTexel\(g:vec2u\)\{\n sp=spBase;/)
})
