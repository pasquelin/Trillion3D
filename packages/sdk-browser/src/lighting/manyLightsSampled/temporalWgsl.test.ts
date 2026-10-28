import test from 'node:test'
import assert from 'node:assert/strict'
import { TEMPORAL_ENTRY, temporalWgsl } from './temporalWgsl.ts'

test('the temporal filter reads the five-tap Catmull-Rom history where its twelve texels are kept, the kept bilinear weights else, and writes four outputs', () => {
  const code = temporalWgsl()
  assert.ok(code.includes(`fn ${TEMPORAL_ENTRY}(`))
  assert.ok(code.includes('fn catmullRom('))
  assert.ok(
    code.includes('if(!ok&&!corner){bicubic=false;}'),
    'every texel of the 4 by 4 but the corners must be kept',
  )
  for (const out of ['filteredDiffuse', 'filteredSpecular', 'filteredMoments', 'filteredFrames'])
    assert.ok(code.includes(`textureStore(${out},pixel,`), out)
  assert.ok(code.includes('fn toYcocg('), 'the engine’s colour space, not a copy')
})
