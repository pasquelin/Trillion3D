import assert from 'node:assert/strict'
import test from 'node:test'
import { radianceProbeDrawWgsl, radianceProbeListWgsl } from './radianceProbesWgsl.ts'

test('the list kernels clear the count of the draw and append the cells and adaptive probes that hold a probe', () => {
  assert.match(radianceProbeListWgsl, /atomicStore\(&drawArgs\[0\],36u\);/)
  assert.match(radianceProbeListWgsl, /atomicStore\(&drawArgs\[1\],0u\);/)
  assert.match(radianceProbeListWgsl, /for\(var rank=0u;rank<=vis\.pick\.w;rank\+\+\)\{/)
  assert.match(radianceProbeListWgsl, /if\(visHeld\(level,cell,rank\)==0u\)\{continue;\}/)
})

test('the fragment cuts the sphere out of the cube and colours it as the irradiance cache does', () => {
  const code = radianceProbeDrawWgsl('rgba16float')
  assert.match(code, /if\(t<0\.0\)\{discard;\}/)
  assert.match(code, /lighting=fieldIrradiance\(slot,normal\)\*0\.3;/)
  assert.match(code, /if\(dot\(shift,shift\)>0\.0\)\{lighting\.g\+=0\.1;\}/)
  assert.match(code, /if\(probeValid\[slot\]==0u\)\{lighting=vec3f\(1\.0,0\.0,0\.0\);\}/)
  assert.match(code, /if\(in\.rank>0u\)\{lighting=vec3f\(0\.0,1\.0,1\.0\);\}/)
  assert.match(code, /var lighting=vec3f\(0\.0,1000\.0,0\.0\);/)
})
