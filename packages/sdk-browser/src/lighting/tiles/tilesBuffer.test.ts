// The light grid's one buffer follows the engine's one growth rule (`sizedBuffer`): held while it
// holds the grid, else grown to twice its size at least — never past what the device binds —, the
// old one retired after the frame's submit, since the image being encoded may still name it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createGpuLightTiles } from './tiles.ts'
import { CELL_WORDS_WORD } from './lightGrid.ts'
import { destroyRetired } from '../../gpu/core/frameRetire.ts'
import { storageBufferCap } from '../../session/memory/pools.ts'
import { GRID_HEAD_WORDS } from '../direct/lightWgsl.ts'
import { LIGHT_LINK_STRIDE } from './compactWgsl.ts'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'

test('the light tiles grow by the one rule, retired after the submit, held when they fit', async () => {
  const fake = fakeDevice()
  const tiles = await createGpuLightTiles(fake.device)
  const lights = fake.device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE })
  tiles.ensure(64, 64, lights, 32, true)
  const small = tiles.buffer!,
    columns = [tiles.tilesX, tiles.tilesY]
  tiles.ensure(640, 640, lights, 32, true)
  const grown = tiles.buffer!
  assert.notEqual(grown, small)
  assert.ok(grown.size >= 2 * small.size, 'twice the held size at least')
  assert.ok(grown.size <= storageBufferCap(fake.device.limits))
  assert.equal(fake.destroyed.includes(small), false, 'not destroyed while the image may name it')
  destroyRetired(fake.device)
  assert.equal(fake.destroyed.includes(small), true)
  // Fewer columns — another view drawn in turn —: the layout held.
  tiles.ensure(64, 64, lights, 32, true)
  assert.equal(tiles.buffer, grown)
  assert.deepEqual([tiles.tilesX, tiles.tilesY], columns, 'the drawn view’s own columns')
})

test('the grid is told the cull and the fog’s slice map in the seven words of its uniform that follow the records’ start', async () => {
  const fake = fakeDevice()
  const tiles = await createGpuLightTiles(fake.device)
  const lights = fake.device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE })
  tiles.ensure(64, 64, lights, 32, true)
  const cull = new Float32Array([1, 2, 3, 4, 5, 6, 7])
  tiles.update(new Float64Array(16), [0, 0, 0], 64, 64, {
    depth: undefined,
    words: cull,
    map: new Float32Array(GRID_HEAD_WORDS),
  })
  const uniform = fake.writes
    .filter((write) => (write.data as ArrayBufferView).byteLength === 44 * 4)
    .at(-1)!
  const { buffer, byteOffset } = uniform.data as ArrayBufferView
  const words = new Float32Array(buffer, byteOffset, 44)
  assert.deepEqual([...words.subarray(36, 43)], [...cull])
  assert.equal(words[43], 0, 'the padding after the slice map')
})

test('the links of the cells’ chains are a buffer of their own, two words for each word of the pool', async () => {
  const fake = fakeDevice()
  const tiles = await createGpuLightTiles(fake.device)
  const lights = fake.device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE })
  const links = () => fake.buffers.filter((buffer) => buffer.label?.includes('links')).at(-1)!
  tiles.ensure(64, 64, lights, 32, true)
  const pool = LIGHT_SETTINGS.gridSlices * 32
  assert.ok(links().size >= pool * LIGHT_LINK_STRIDE * 4, 'a link for each word the pool holds')
  assert.ok(links().size <= storageBufferCap(fake.device.limits))
  // Lists in the words of each cell: one link bound; the chains again: the pool's links.
  tiles.ensure(64, 64, lights, 32, false)
  assert.equal(links().size, LIGHT_LINK_STRIDE * 4)
  tiles.ensure(64, 64, lights, 32, true)
  assert.ok(links().size >= pool * LIGHT_LINK_STRIDE * 4)
})

test('the grid is told how many words each cell has of its own, none for chains of links', async () => {
  const fake = fakeDevice()
  const tiles = await createGpuLightTiles(fake.device)
  const lights = fake.device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE })
  /** The uniform's word that holds the cell's words, after an image of lists made so. */
  const cellWords = (linked = true) => {
    tiles.ensure(64, 64, lights, 32, linked)
    tiles.update(new Float64Array(16), [0, 0, 0], 64, 64, {
      depth: undefined,
      words: new Float32Array(7),
      map: new Float32Array(GRID_HEAD_WORDS),
    })
    const { buffer, byteOffset } = fake.writes
      .filter((write) => (write.data as ArrayBufferView).byteLength === 44 * 4)
      .at(-1)!.data as ArrayBufferView
    return new Uint32Array(buffer, byteOffset, 44)[CELL_WORDS_WORD]
  }
  assert.equal(cellWords(), 0, 'chains of links by default')
  assert.equal(cellWords(true), 0)
  assert.equal(cellWords(false), 32)
})
