import test from 'node:test'
import assert from 'node:assert/strict'
import { SSS_VISUALIZE_ENTRY, SSS_VISUALIZE_WGSL } from './visualizeWgsl.ts'

test('the profile map has its entry, a glyph for every digit and letter and the reference’s profile colours', () => {
  assert.ok(SSS_VISUALIZE_WGSL.includes(`fn ${SSS_VISUALIZE_ENTRY}(`))
  assert.ok(SSS_VISUALIZE_WGSL.includes('const GLYPHS=array<u32,37>('))
  assert.ok(SSS_VISUALIZE_WGSL.includes('vec3f(0.8,0.7,0.6)'))
  assert.ok(SSS_VISUALIZE_WGSL.includes('if(id==255u)'))
  assert.ok(!SSS_VISUALIZE_WGSL.includes('`'))
})
