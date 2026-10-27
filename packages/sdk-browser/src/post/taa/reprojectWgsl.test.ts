import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslSource } from '../../../../math/src/wgsl/source.fixture.ts'
import { reprojectShader } from './reprojectWgsl.ts'

test('the thin coverage history is read only where the detection runs, the word byte 0 else', () => {
  const text = wgslSource(reprojectShader('rgba8unorm'))
  assert.match(
    text,
    /var coverage=0u;\s*if\(view\.quality\.w!=0\.0\)\{coverage=measureByte\(textureLoad\(prevThin,/,
  )
  assert.equal(text.match(/textureLoad\(prevThin,/g)?.length, 1)
})
