import test from 'node:test'
import assert from 'node:assert/strict'
import { SIMPLE_WORD } from '../../../../sdk-core/src/scene/light/fields.ts'
import { DIRECT_LIGHT_WGSL } from './lightWgsl.ts'
import { SIMPLE_LIGHT_WGSL } from './simpleLightWgsl.ts'
import { TILE_SLICE_WGSL } from './lightingWgsl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'

test('the simple light word is read from the simple lights alone, with the bits the CPU writes', () => {
  const code = wgslProgram('', [SIMPLE_LIGHT_WGSL])
  assert.ok(code.includes(`const SIMPLE_CLASSIC:u32=${SIMPLE_WORD.classic}u;`))
  assert.ok(code.includes('if(rank<directLights.count){return 0u;}'), 'a scene light’s word is 0')
  assert.ok(
    !code.includes('previousRankOf'),
    'the rank before is per view, in the programs that read it',
  )
})

test('the light grid and the lights’ declarations carry the simple light word, and the simple lights’ tail is found by halving the list', () => {
  for (const block of [DIRECT_LIGHT_WGSL, TILE_SLICE_WGSL]) {
    const code = wgslProgram('', [block])
    assert.ok(code.includes('fn sampledTakes('))
  }
  assert.ok(wgslProgram('', [TILE_SLICE_WGSL]).includes('fn firstSimpleIndex('))
  assert.ok(!wgslProgram('', [SIMPLE_LIGHT_WGSL]).includes('`'), 'no backtick in the WGSL text')
})
