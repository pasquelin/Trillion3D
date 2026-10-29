import assert from 'node:assert/strict'
import test from 'node:test'
import { tileQuadsWgsl } from './tileQuads.ts'

test('each tile of each mode is a filled quad of its colour at half alpha, over the pixels it covers', () => {
  assert.match(tileQuadsWgsl, /array<u32,3>\(2147548928u,/)
  assert.match(tileQuadsWgsl, /if\(id\.x>=tileCounts\[9u\+mode\]\)\{return;\}/)
  assert.match(tileQuadsWgsl, /tileList\[mode\*tiles\.grid\.x\+id\.x\]/)
  assert.match(tileQuadsWgsl, /gpuLineFilled\(lo,lo\+side\*tiles\.scale\.xy,colors\[mode\]\)/)
})
