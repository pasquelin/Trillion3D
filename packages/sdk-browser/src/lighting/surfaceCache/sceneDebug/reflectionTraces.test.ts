import assert from 'node:assert/strict'
import test from 'node:test'
import { reflectionTraceWgsl } from './reflectionTraces.ts'

test('the kernel finds the ray of the grid texel under the cursor and draws it, its end crossed in yellow', () => {
  assert.match(reflectionTraceWgsl, /fn debugReflectionTraces\(/)
  assert.match(
    reflectionTraceWgsl,
    /if\(query\.cursor\.x<0\.0\|\|query\.cursor\.y<0\.0\)\{return;\}/,
  )
  assert.match(reflectionTraceWgsl, /let g=pixel\/reflectionBlock\(\);/)
  assert.match(reflectionTraceWgsl, /if\(!\(depth>0\.0\)\)\{return;\}/)
  assert.match(
    reflectionTraceWgsl,
    /let end=point\+normalize\(reflectionRayAt\(vec2i\(g\)\)\.xyz\)\*hit;/,
  )
  assert.match(
    reflectionTraceWgsl,
    /gpuLineWorld\(point,end,pack4x8unorm\(vec4f\(saturate\(radiance\),1\.0\)\)\)/,
  )
  assert.match(reflectionTraceWgsl, /gpuLineCross\(end,0\.02,/)
})

test('the kernel writes the texel, the distance and the radiance for the text', () => {
  assert.match(reflectionTraceWgsl, /found\[0\]=vec4f\(vec2f\(g\),2\.0,hit\);/)
  assert.match(reflectionTraceWgsl, /found\[1\]=vec4f\(radiance,0\.0\);/)
})
