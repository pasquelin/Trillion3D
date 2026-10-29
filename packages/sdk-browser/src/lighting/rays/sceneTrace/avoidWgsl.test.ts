// The ray that avoids the geometry it starts on (`avoidWgsl.ts`): the three modes, the retrace once and the hair past a two-sided hit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { sceneTraceAvoidWgsl } from './avoidWgsl.ts'

const { text } = sceneTraceAvoidWgsl(2, 0)

test('the modes are cull 0, retrace 1, skip 2 and the retrace is made once', () => {
  assert.match(text, /const ST_AVOID_CULL:u32=0u;/)
  assert.match(text, /const ST_AVOID_RETRACE:u32=1u;/)
  assert.match(text, /const ST_AVOID_SKIP:u32=2u;/)
  assert.match(text, /if\(avoid==ST_AVOID_CULL\)\{flags\|=ST_CULL_BACK;\}/)
  assert.match(text, /if\(avoid>=ST_AVOID_SKIP\)\{flags\|=ST_SKIP_NEAR;\}/)
  assert.match(text, /if\(avoid!=ST_AVOID_RETRACE\|\|!hit\.hit\|\|trace==1u\)\{break;\}/)
  assert.match(text, /past=hit\.distance\+0\.01\/100\.0;/)
})
