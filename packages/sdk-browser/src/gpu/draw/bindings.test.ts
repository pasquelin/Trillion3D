import test from 'node:test'
import assert from 'node:assert/strict'
import { drawBindEntries, drawShader } from './shader.ts'
import { entryBufferBindings, wgslBufferBindings } from '../core/wgslBindings.fixture.ts'

test('the draw compaction layout entries are the bindings its shader declares, each half', () => {
  for (const layers of [1, 4])
    for (const [tested, count] of [
      [false, 7],
      [true, 9],
    ] as const) {
      const declared = wgslBufferBindings(drawShader(layers, tested))
      assert.equal(declared.length, count)
      assert.deepEqual(entryBufferBindings(drawBindEntries(tested)), declared, `${layers} layers`)
    }
})
