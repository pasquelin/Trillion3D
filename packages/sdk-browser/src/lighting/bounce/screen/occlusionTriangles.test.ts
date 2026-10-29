// The short-range occlusion cast through the scene's triangles: its settings and its program.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveScreenProbes,
  SCREEN_PROBE_RULES,
} from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { kernelShapeOf } from './kernels.ts'
import { occlusionTrianglesEntries, occlusionTrianglesProgram } from './occlusionTrianglesWgsl.ts'

const settingsOf = (options: Record<string, unknown>) =>
  resolveScreenProbes(resolveSettings(SCREEN_PROBE_RULES, options))

test('the occlusion is cast through the triangles only when asked, with four rays, eight from a quality of 2 and sixteen from 6', () => {
  assert.equal(settingsOf({}).occlusionTriangles, false)
  const on = settingsOf({ screenProbeShortRangeAOHardwareRayTracing: true })
  assert.deepEqual(
    [on.occlusionTriangles, on.occlusionTriangleRays, on.occlusionTriangleBias],
    [true, 4, 0.001],
  )
  assert.equal(
    settingsOf({ screenProbeShortRangeAOHardwareRayTracing: true, screenProbeQuality: 2 })
      .occlusionTriangleRays,
    8,
  )
  assert.equal(
    settingsOf({ screenProbeShortRangeAOHardwareRayTracing: true, screenProbeQuality: 6 })
      .occlusionTriangleRays,
    16,
  )
})

test('the program has its kernel, writes the bent normal word or the amount, and holds no backtick', () => {
  const settings = settingsOf({ screenProbeShortRangeAOHardwareRayTracing: true })
  const { occlusion, samples } = kernelShapeOf(settings)
  for (const bentNormal of [false, true]) {
    const code = occlusionTrianglesProgram({ ...occlusion, bentNormal }, samples, 4, 0.001)
    assert.ok(code.includes('fn occlusionTriangles('))
    assert.ok(code.includes('ST_SKIP_TRANSLUCENT|ST_ANY_HIT'))
    assert.equal(code.includes('spBentPack(stored)'), bentNormal)
    const bare = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.ok(!bare.includes('`'))
    assert.ok(
      occlusionTrianglesEntries(bentNormal).some(
        (entry) => entry.storageTexture?.format === (bentNormal ? 'r32uint' : 'r32float'),
      ),
    )
  }
})
