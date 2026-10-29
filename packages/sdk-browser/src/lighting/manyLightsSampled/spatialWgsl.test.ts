import test from 'node:test'
import assert from 'node:assert/strict'
import { SPATIAL_ENTRY, spatialWgsl } from './spatialWgsl.ts'

test('the spatial filter reuses the engine’s samplers and writes the light to add, detail put back', () => {
  const code = spatialWgsl()
  assert.ok(code.includes(`fn ${SPATIAL_ENTRY}(`))
  assert.ok(
    code.includes('fn hammersley16(') && code.includes('fn uniformDiskConcentric('),
    'the shared sampling, not a copy',
  )
  assert.ok(code.includes('textureStore(composite,vec2i(screen),'))
  assert.ok(
    code.includes('fn environmentBrdf('),
    'the specular share of the environment is the demodulation of the shading',
  )
})

test('the debug variant of the spatial filter writes the views’ values, the plain one nothing', () => {
  const plain = spatialWgsl()
  const debug = spatialWgsl(true)
  assert.ok(!plain.includes('debugPixels'))
  assert.ok(debug.includes('var debugPixels:texture_storage_2d<rgba32float,write>'))
  // The values of a filtered pixel, and of one that is no lit surface (the sky marked), both end in the debug texture.
  assert.ok(debug.includes('vec4f(dbgStd,disocclusion,f32(dbgFlags))'))
  assert.ok(debug.split('textureStore(debugPixels,').length > 8)
  assert.ok(debug.includes('textureLoad(depth,vec2i(screen),0)<=0.0'))
  assert.ok(debug.includes('textureStore(composite,vec2i(screen),vec4f(diffuse+max(specular'))
})
