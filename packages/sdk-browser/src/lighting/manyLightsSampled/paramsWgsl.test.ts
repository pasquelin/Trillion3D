import test from 'node:test'
import assert from 'node:assert/strict'
import { SAMPLED_LIGHTS_RULES } from '../../../../sdk-core/src/contracts/sampledLightsOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { sampledGeometry } from './layout.ts'
import { hashFilterOn } from './hashWgsl.ts'
import { SAMPLED_PARAMS_WORDS, directionalRatio, writeSampledParams } from './paramsWgsl.ts'

test('the uniform holds the geometry, the switches and the weights at the words its struct declares', () => {
  const g = sampledGeometry(1920, 1080, [2, 2], [2, 2])
  const settings = resolveSettings(SAMPLED_LIGHTS_RULES, {
    sampledLights: true,
    sampledLightsDirectional: true,
  })
  const out = writeSampledParams(new ArrayBuffer(SAMPLED_PARAMS_WORDS * 4), g, settings, {
    frame: 7,
    history: true,
    historyTiles: [240, 135],
    textured: false,
    previousViewProjection: Array.from({ length: 16 }, (_, i) => i),
    fastClear: true,
    soft: true,
    specularOnly: false,
  })
  const w = new Uint32Array(out)
  const f = new Float32Array(out)
  assert.deepEqual([...w.slice(0, 12)], [240, 135, 120, 68, 2, 2, 2, 2, 960, 540, 1920, 1080])
  assert.deepEqual([...w.slice(12, 20)], [240 * 135, 1, 0, 1, 7, 1, 1, 4])
  assert.deepEqual([...w.slice(20, 24)], [240, 135, 240 * 135 * 4, 240 * 135 * 6])
  assert.ok(Math.abs(f[24]! - 0.001 / 0.18) < 1e-7)
  assert.ok(Math.abs(f[26]! - 0.1) < 1e-7 && Math.abs(f[27]! - 0.4) < 1e-7)
  assert.equal(f[29], 1)
  assert.equal(w[31], 1)
  assert.equal(f[32], 0)
  assert.equal(f[47], 15)
  assert.equal(out.byteLength, 320)
  assert.equal(f[48], 1)
  assert.equal(w[52], 1)
  assert.equal(w[53], 50)
})

test('the history guides the draw only where the setting and the guide both say so', () => {
  const g = sampledGeometry(64, 64, [1, 1], [1, 1])
  const image = {
    frame: 0,
    history: true,
    historyTiles: [8, 8] as [number, number],
    textured: false,
    fastClear: false,
    soft: true,
    specularOnly: false,
    previousViewProjection: new Array(16).fill(0),
  }
  const run = (guide: boolean, history: boolean) =>
    new Uint32Array(
      writeSampledParams(
        new ArrayBuffer(SAMPLED_PARAMS_WORDS * 4),
        g,
        resolveSettings(SAMPLED_LIGHTS_RULES, { sampledLightsGuideByHistory: guide }),
        { ...image, history },
      ),
    )[15]
  assert.deepEqual([run(true, true), run(false, true), run(true, false)], [1, 0, 0])
})

test('the directional lights’ ratio is fraction over its complement, none at 1', () => {
  assert.equal(directionalRatio(0.5), 1)
  assert.equal(directionalRatio(0.75), 3)
  assert.equal(directionalRatio(1), 0)
})

test('the tiles’ hashes are joined only while the history guides the draw and the filter is on', () => {
  const on = (guide: boolean, filter: boolean) =>
    hashFilterOn(
      resolveSettings(SAMPLED_LIGHTS_RULES, {
        sampledLightsGuideByHistory: guide,
        sampledLightsGuideByHistoryFilter: filter,
      }),
    )
  assert.deepEqual([on(true, true), on(true, false), on(false, true)], [true, false, false])
})
