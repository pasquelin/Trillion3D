// The light grid's one buffer follows the engine's one growth rule (`sizedBuffer`): held while it
// holds both grids, else grown to twice its size at least — never past what the device binds —, the
// old one retired after the frame's submit, since the image being encoded may still name it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createGpuLightTiles } from './tiles.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { storageBufferCap } from '../../session/memory/pools.ts'

test('the light tiles grow by the one rule, retired after the submit, held when they fit', async () => {
  const fake = fakeDevice()
  const tiles = await createGpuLightTiles(fake.device)
  const lights = fake.device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE })
  tiles.ensure(64, 64, lights, 4)
  const small = tiles.buffer!,
    columns = [tiles.tilesX, tiles.tilesY]
  const revision = tiles.revision
  tiles.ensure(640, 640, lights, 4)
  const grown = tiles.buffer!
  assert.notEqual(grown, small)
  assert.ok(grown.size >= 2 * small.size, 'twice the held size at least')
  assert.ok(grown.size <= storageBufferCap(fake.device.limits))
  assert.equal(tiles.revision, revision + 1, 'the world lists are listed again')
  assert.equal(fake.destroyed.includes(small), false, 'not destroyed while the image may name it')
  destroyRetired(fake.device)
  assert.equal(fake.destroyed.includes(small), true)
  // Fewer columns — another view drawn in turn —: the layout held, the world lists untouched.
  tiles.ensure(64, 64, lights, 4)
  assert.equal(tiles.buffer, grown)
  assert.equal(tiles.revision, revision + 1)
  assert.deepEqual([tiles.tilesX, tiles.tilesY], columns, 'the drawn view’s own columns')
})
