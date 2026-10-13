import test from 'node:test'
import assert from 'node:assert/strict'
import { HIZ_SHADER, hizBindEntries } from './shader.ts'
import { hizDepthEntries, hizDepthWgsl } from './pyramidTexture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  entryBufferBindings,
  wgslBufferBindings,
  wgslTextureBindings,
} from '../core/wgslBindings.fixture.ts'

test('the Hi-Z layout entries are the bindings its shader declares, buffers and textures', () => {
  const entries = hizBindEntries(256)
  const buffers = entries.filter((entry) => entry.buffer)
  assert.deepEqual(entryBufferBindings(buffers), wgslBufferBindings(HIZ_SHADER))
  const textures = entries
    .filter((entry) => entry.texture || entry.storageTexture)
    .map((entry) => entry.binding)
  assert.deepEqual(textures, wgslTextureBindings(HIZ_SHADER))
  assert.equal(buffers.length + textures.length, entries.length, 'every entry is checked')
})

test("a reader of the whole depth binds level 0's opaque and front layers as one texture", () => {
  const entries = hizDepthEntries(3, 4)
  assert.deepEqual(
    entries.map(({ binding }) => binding),
    [3, 4, 5],
  )
  assert.equal(entries[0].texture?.viewDimension, '2d-array')
  const code = wgslModule(hizDepthWgsl(1, 3))
  assert.match(code, /var hizDepth:texture_2d_array<f32>;/)
  assert.doesNotMatch(code, /hizFront:/)
})
