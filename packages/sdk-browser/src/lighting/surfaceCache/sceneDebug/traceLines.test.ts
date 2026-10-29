import assert from 'node:assert/strict'
import test from 'node:test'
import { probeTraceLinesWgsl, probeTraceSetupWgsl } from './traceLines.ts'

test('the setup kernel writes, for each ray of the nearest probe, its point, its length and its radiance, a self-hit short and red', () => {
  assert.match(probeTraceSetupWgsl, /fn debugProbeTraces\(/)
  assert.match(
    probeTraceSetupWgsl,
    /if\(away<best\)\{best=away;chosen=query\.counts\.x\+adaptive;\}/,
  )
  assert.match(
    probeTraceSetupWgsl,
    /if\(hit!=0u&&reached<0\.01\)\{reached=0\.05;light=vec3f\(1\.0,0\.0,0\.0\);\}/,
  )
  assert.match(probeTraceSetupWgsl, /traces\[slot\+1u\]=vec4f\(direction\*reached,0\.0\)/)
})

test('the lines kernel draws a segment from the point to the end of the ray, in the light through the composition table, against the depth where asked', () => {
  assert.match(probeTraceLinesWgsl, /visualizeTonemap\(light,draw\.tonemap!=0u\)/)
  assert.match(
    probeTraceLinesWgsl,
    /gpuLineWorldDepthTested\(origin,origin\+traces\[slot\+1u\]\.xyz,color\)/,
  )
  assert.match(probeTraceLinesWgsl, /gpuLineWorld\(origin,origin\+traces\[slot\+1u\]\.xyz,color\)/)
})
