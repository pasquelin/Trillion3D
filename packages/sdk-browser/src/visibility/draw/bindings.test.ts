import test from 'node:test'
import assert from 'node:assert/strict'
import { drawBindEntries, drawShader } from './shader.ts'
import { entryBufferBindings, wgslBufferBindings } from '../../gpu/core/wgslBindings.fixture.ts'

test('the draw compaction layout entries are the bindings its shader declares, each half', () => {
  for (const layers of [1, 4])
    for (const post of [false, true]) {
      const declared = wgslBufferBindings(drawShader(layers, post))
      assert.equal(declared.length, 6)
      assert.deepEqual(entryBufferBindings(drawBindEntries()), declared, `${layers} layers`)
    }
})
