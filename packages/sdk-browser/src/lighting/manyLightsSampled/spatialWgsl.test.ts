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
