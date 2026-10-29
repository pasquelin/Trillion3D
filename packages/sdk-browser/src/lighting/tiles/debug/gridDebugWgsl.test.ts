import assert from 'node:assert/strict'
import test from 'node:test'
import { DIGIT_GLYPH_BITS } from '../../../hair/debugFont.ts'
import { LIGHT_GRID_DEBUG_WGSL } from './gridDebugWgsl.ts'

test('the digits are packed from the debug font: a 3 by 5 glyph in fifteen bits', () => {
  assert.equal(DIGIT_GLYPH_BITS.length, 10)
  // 1 is ['.#.', '##.', '.#.', '.#.', '###']: bits 1, 3, 4, 7, 10, 12, 13, 14.
  assert.equal(
    DIGIT_GLYPH_BITS[1],
    (1 << 1) | (1 << 3) | (1 << 4) | (1 << 7) | (1 << 10) | (7 << 12),
  )
  assert.equal(DIGIT_GLYPH_BITS[8], 0b111101111101111)
})

test('a cell with no list counts the scene lights, a cell with a list its count without the shadow bit', () => {
  assert.match(
    LIGHT_GRID_DEBUG_WGSL,
    /select\(grid\[base\]&~TILE_SHADOWED,dbg\.lights,grid\[base\+1u\]==TILE_NO_SLICE\)/,
  )
})

test('view 2 leaves the last slice out and a slice asked shows that one alone', () => {
  assert.match(
    LIGHT_GRID_DEBUG_WGSL,
    /select\(select\(GRID_SLICES,GRID_SLICES-1u,dbg\.mode==2u\),first\+1u,dbg\.slice>=0\)/,
  )
  assert.match(LIGHT_GRID_DEBUG_WGSL, /if\(dbg\.mode==1u&&dbg\.slice<0\)/)
})
