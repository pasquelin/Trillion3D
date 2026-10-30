// The part a view draws and the key of the history it continues: the alpha holdout and the debug views change what is
// traced, so they change the part or cut the history.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { SKY_QUALITY_RULES } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import { resolveCloudPart } from '../../../../../sdk-core/src/modules/sky/clouds.ts'
import { cloudHistoryKey, drawnPartOf } from './drawnPart.ts'
import { COMPOSE_TARGETS } from './compose.ts'
import { cloudLightWgsl } from './traceLightWgsl.ts'

const part = (quality: Record<string, unknown>, settings: Record<string, unknown> = {}) =>
  resolveCloudPart(settings, resolveSettings(SKY_QUALITY_RULES, quality))

test('a debug view of the tracing has no haze traced apart, the others keep the option', () => {
  const plain = part({ cloudHighQualityAerial: true })
  assert.equal(drawnPartOf(plain, false), plain, 'no debug view: the part as it is')
  const debug = part({ cloudHighQualityAerial: true, cloudDebugView: 'conservativeDensity' })
  assert.equal(drawnPartOf(debug, false).quality.cloudHighQualityAerial, false)
  assert.equal(drawnPartOf(debug, false), drawnPartOf(debug, false), 'made once for a part')
  assert.equal(debug.quality.cloudHighQualityAerial, true, 'the part itself is not written')
})

test('clouds that hold their light out do so with the alpha holdout alone', () => {
  const hole = part({}, { alphaHole: true })
  assert.equal(drawnPartOf(hole, true), hole)
  assert.equal(drawnPartOf(hole, false).settings.alphaHole, false)
})

test('the history key follows the allocated size and the debug view: changing the view is a cut', () => {
  const size = { width: 1920, height: 1080 }
  assert.notEqual(cloudHistoryKey(size, 0), cloudHistoryKey(size, 1))
  assert.notEqual(cloudHistoryKey(size, 1), cloudHistoryKey(size, 2))
  assert.notEqual(cloudHistoryKey(size, 0), cloudHistoryKey({ ...size, width: 1280 }, 0))
  assert.equal(cloudHistoryKey(size, 2), cloudHistoryKey({ ...size }, 2))
})

test('a debug view of a direct trace replaces the colour without a blend, keeping the alpha', () => {
  assert.ok(COMPOSE_TARGETS.over.blend)
  assert.equal(COMPOSE_TARGETS.replace.blend, undefined, 'no blend')
  assert.equal(COMPOSE_TARGETS.replace.writeMask, 0x7, 'the colour alone')
  assert.equal(COMPOSE_TARGETS.holdout.writeMask, 0x8, 'the alpha alone')
})

test('a debug view lights the cloud with the first light alone and no air tint; the plain light is untouched', () => {
  for (const fromMap of [false, true]) {
    const plain = cloudLightWgsl(fromMap).text
    assert.match(plain, /l\.count=suns\.count;/)
    assert.match(plain, /if\(cloudTrace\.sizes\.y!=1u\)\{return air;\}/)
    const debug = cloudLightWgsl(fromMap, true).text
    assert.match(debug, /l\.count=min\(suns\.count,1u\);/)
    assert.match(debug, /outer,true\);/)
    assert.doesNotMatch(debug, /if\(cloudTrace\.sizes\.y!=1u\)/)
  }
})
