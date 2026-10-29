import assert from 'node:assert/strict'
import test from 'node:test'
import { probePlacementWgsl } from './probePlacement.ts'

test('the placement appends a quad at the pixel of each lit probe, or a cross and its normal in mode 3', () => {
  assert.match(probePlacementWgsl, /if\(info\.w<0\.0\)\{return;\}/)
  assert.match(probePlacementWgsl, /if\(!adaptive&&mode==2u\)\{return;\}/)
  assert.match(
    probePlacementWgsl,
    /gpuLineRect\(pixel-place\.scale\.zw,pixel\+place\.scale\.zw,color\)/,
  )
  assert.match(probePlacementWgsl, /gpuLineCross\(info\.xyz,place\.reach\.x,color\)/)
})
