// The one writer of the lighting's words: its module, its bindings and the words it writes.

import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import {
  INDIRECT_WORDS_BINDINGS,
  indirectWordsEntries,
  indirectWordsProgram,
} from './indirectWordsWgsl.ts'

test('the writer is a module a device takes, with an amount or the bent normal’s word as the openness, its bindings the layout holds', () => {
  for (const bent of [false, true]) {
    assertProgramAssembles(indirectWordsProgram(bent), 'indirectWords', `indirectWords ${bent}`)
    assert.deepEqual(
      indirectWordsEntries(bent)
        .map((entry) => entry.binding)
        .sort(),
      Object.values(INDIRECT_WORDS_BINDINGS).sort(),
    )
  }
})

test('the irradiance is pi times the mean radiance, the bent normal the normal times the openness, and a pixel nothing answered has zero words', () => {
  const code = indirectWordsProgram(false)
  assert.match(code, /packLight\(irradiance\*inverse\*PI\*bitcast<f32>\(source\.z\)\)/)
  assert.match(code, /let bent=spBentPack\(N\*max\(openness\*inverse,1\.0\/255\.0\)\);/)
  assert.match(code, /if\(total<=1e-6\)\{textureStore\(wordsOut,at,vec4u\(0u\)\);return;\}/)
})

test('the field’s occlusion with the bent normal is written as it is, from the pixel’s own texel, the normal where the texel holds none', () => {
  const code = indirectWordsProgram(true)
  assert.match(code, /var open:texture_2d<u32>;/)
  assert.match(code, /let bent=select\(spBentPack\(N\),word,word!=0u\);/)
})
