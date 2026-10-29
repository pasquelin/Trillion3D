// The temporal stage's derived settings and the denoiser's WGSL texts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { PATH_TRACING_RULES } from '../../../../sdk-core/src/contracts/pathTracingOptions.ts'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { DN_COLOR_WGSL } from './denoiseColorWgsl.ts'
import { DN_MOTION_ENTRIES, DN_MOTION_PROGRAMS } from './denoiseMotionWgsl.ts'
import {
  blendingFactors,
  blurSize,
  denoiseMips,
  errorDistanceOfDeltaE,
  removesSelfOffset,
  usesSubPixel,
  usesTotalVariation,
  wantsVarianceMap,
  wantsVarianceTexture,
} from './denoiseParams.ts'
import { DN_PREPASS_ENTRIES, DN_PREPASS_PROGRAMS } from './denoisePrepassWgsl.ts'
import { DN_RESOLVE_ENTRIES, DN_RESOLVE_PROGRAMS } from './denoiseResolveWgsl.ts'
import { DN_SPATIAL_ENTRY, DN_SPATIAL_WGSL } from './denoiseSpatialWgsl.ts'
import { DN_VISUALIZE_ENTRIES, DN_VISUALIZE_PROGRAMS } from './denoiseVisualizeWgsl.ts'

const settings = (options: Parameters<typeof resolveSettings<typeof PATH_TRACING_RULES>>[1] = {}) =>
  resolveSettings(PATH_TRACING_RULES, options)

test('the blending factors default to one just-noticeable difference of eta and a history that reaches zero at 5 of colour difference', () => {
  const { kappa, eta, alpha } = blendingFactors(settings())
  assert.equal(eta, 1)
  assert.equal(alpha, 1)
  assert.ok(Math.abs(kappa - 1 / (errorDistanceOfDeltaE(5) - 1)) < 1e-9)
  const derived = blendingFactors(settings({ pathTracingTemporalDenoiserEta: -1 }))
  assert.equal(derived.eta, errorDistanceOfDeltaE(1))
  assert.equal(blendingFactors(settings({ pathTracingTemporalDenoiserKappa: 3 })).kappa, 3)
})

test('a delta E under one is raised to just over one, so that kappa stays finite', () => {
  const { kappa } = blendingFactors(
    settings({ pathTracingTemporalDenoiserDeltaE: 0, pathTracingTemporalDenoiserEta: -1 }),
  )
  assert.ok(Number.isFinite(kappa) && kappa > 0)
})

test('the levels 6, 4, 2 and 0 take 1, 1, 2 and 3 blurs and the pyramid has 7 levels from 64 pixels', () => {
  assert.deepEqual([6, 4, 2, 0].map(blurSize), [1, 1, 2, 3])
  assert.equal(denoiseMips([1920, 1080]), 7)
  assert.equal(denoiseMips([32, 4000]), 6)
})

test('the sub-pixel fit, the image’s own motion and the total variation follow their settings and levels', () => {
  const on = settings()
  assert.ok(removesSelfOffset(on, 4) && usesSubPixel(on, 0))
  assert.ok(usesTotalVariation(on, 0) && !usesTotalVariation(on, 2))
  const off = settings({ pathTracingTemporalDenoiserSubPixelOffset: false })
  assert.ok(!removesSelfOffset(off, 0) && !usesSubPixel(off, 0) && !usesTotalVariation(off, 0))
  assert.ok(
    !removesSelfOffset(settings({ pathTracingTemporalDenoiserSubPixelOffsetStartMip: 3 }), 4),
  )
  assert.ok(!removesSelfOffset(settings({ pathTracingTemporalDenoiserMotionOperation: 0 }), 4))
})

test('the variance map is kept for the spatial stage and the fusion, the image for the spatial stage or on demand', () => {
  assert.ok(wantsVarianceMap(settings()) && wantsVarianceTexture(settings()))
  const none = settings({ pathTracingSpatialDenoiser: false })
  assert.ok(!wantsVarianceMap(none) && !wantsVarianceTexture(none))
  const fusion = settings({
    pathTracingSpatialDenoiser: false,
    pathTracingTemporalDenoiserSource: 7,
  })
  assert.ok(wantsVarianceMap(fusion) && !wantsVarianceTexture(fusion))
  assert.ok(
    wantsVarianceTexture(
      settings({
        pathTracingSpatialDenoiser: false,
        pathTracingDenoiserOutputVarianceTexture: true,
      }),
    ),
  )
})

test('the denoiser’s programs assemble: every name declared, none reserved, every entry present', () => {
  for (const [name, entry] of Object.entries(DN_MOTION_ENTRIES))
    assertProgramAssembles(
      DN_MOTION_PROGRAMS[name as keyof typeof DN_MOTION_PROGRAMS],
      entry,
      `the motion ${entry}`,
    )
  for (const [name, entry] of Object.entries(DN_RESOLVE_ENTRIES))
    assertProgramAssembles(
      DN_RESOLVE_PROGRAMS[name as keyof typeof DN_RESOLVE_PROGRAMS],
      entry,
      `the temporal ${entry}`,
    )
  for (const [name, entry] of Object.entries(DN_PREPASS_ENTRIES))
    assertProgramAssembles(
      DN_PREPASS_PROGRAMS[name as keyof typeof DN_PREPASS_PROGRAMS],
      entry,
      `the prepass ${entry}`,
    )
  for (const [name, entry] of Object.entries(DN_VISUALIZE_ENTRIES))
    assertProgramAssembles(
      DN_VISUALIZE_PROGRAMS[name as keyof typeof DN_VISUALIZE_PROGRAMS],
      entry,
      `the view ${entry}`,
    )
  assertProgramAssembles(DN_SPATIAL_WGSL, DN_SPATIAL_ENTRY, 'the spatial filter')
})

test('no storage texture count passes the four a stage may bind, and no program writes a backtick', () => {
  const programs = [
    ...Object.values(DN_MOTION_PROGRAMS),
    ...Object.values(DN_RESOLVE_PROGRAMS),
    ...Object.values(DN_PREPASS_PROGRAMS),
    ...Object.values(DN_VISUALIZE_PROGRAMS),
    DN_SPATIAL_WGSL,
  ]
  for (const text of programs) {
    assert.ok((text.match(/texture_storage_2d/g) ?? []).length <= 4)
    assert.ok(!text.includes('`'))
  }
})

const color = () =>
  shaderRun<{
    dnDeltaE: (a: number[], b: number[]) => number
    dnDistance: (a: number[], b: number[], shift: number[], metric: number) => number
  }>(wgslSource(DN_COLOR_WGSL), ['dnDeltaE', 'dnDistance'], {})

test('two equal colours differ by nothing, a darker one by more, whatever the metric', () => {
  const { dnDeltaE, dnDistance } = color()
  assert.ok(dnDeltaE([0.5, 0.4, 0.3], [0.5, 0.4, 0.3]) < 1e-6)
  const near = dnDeltaE([0.5, 0.4, 0.3], [0.52, 0.4, 0.3])
  const far = dnDeltaE([0.5, 0.4, 0.3], [0.1, 0.1, 0.1])
  assert.ok(near > 0 && far > near)
  for (const metric of [0, 1, 2]) {
    const same = dnDistance([0.5, 0.4, 0.3], [0.5, 0.4, 0.3], [0, 0], metric)
    assert.ok(Math.abs(same - 1) < 1e-6, 'log2(2) at no difference and no shift')
    assert.ok(dnDistance([0.5, 0.4, 0.3], [0.1, 0.1, 0.1], [0, 0], metric) > same)
    assert.ok(
      dnDistance([0.5, 0.4, 0.3], [0.5, 0.4, 0.3], [2, 2], metric) > same,
      'a longer shift costs more',
    )
  }
})
