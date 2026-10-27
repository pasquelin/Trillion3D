// The direct light's two entries, through the distance field and through the shadow masks, record which lights a tile is
// uniform to in one place: the same words, from the counts of the texels that saw each light and that it did not reach.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { functionsOf } from '../../../materials/texture/shaderRule.fixture.ts'
import { DIRECT_ENTRIES, DIRECT_ENTRY, DIRECT_TRACED_ENTRY, DIRECT_WGSL } from './directWgsl.ts'

test('the program assembles with both entries', () => {
  for (const entry of DIRECT_ENTRIES) assertProgramAssembles(DIRECT_WGSL, entry)
})

test('each entry counts its texels’ sight of every light and records the uniform ones; the words are written in one place', () => {
  for (const entry of [DIRECT_ENTRY, DIRECT_TRACED_ENTRY]) {
    const text = functionsOf(DIRECT_WGSL, [entry])
    assert.ok(text.includes('countLight(k,'), `${entry} counts`)
    assert.ok(text.includes('recordUniformLights(head,lane);'), `${entry} records`)
    assert.ok(!text.includes('factors['), `${entry} writes no word itself`)
  }
  assert.equal(DIRECT_WGSL.split('factors[at0+i]=').length, 2, 'one writer of the words')
})
