// A chunked raster's lists are its context's own buffers: a still frame asks for them again and
// gets the same record, nothing made — no list object, no buffer; the table of the frame's lights
// goes up once, then only the words that changed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { vsmEnsureLists } from './chunkLists.ts'
import { vsmWriteLights } from './chunkParams.ts'
import type { VsmListSizes } from './chunkSizing.ts'

test("the lists returned are the context's own buffers, the same record every frame", () => {
  const ctx = { device: fakeDevice().device as unknown as GPUDevice, buffers: {} }
  const size: VsmListSizes = {
    params: 512,
    views: 64,
    lights: 64,
    candidates: 64,
    counts: 64,
    cmds: 64,
    order: 64,
    pairs: 64,
    args: 64,
  }
  const first = vsmEnsureLists(ctx, 'lists', size)
  const held = { ...first }
  const again = vsmEnsureLists(ctx, 'lists', size)
  assert.equal(again, ctx.buffers, 'the context’s record, no new object')
  assert.equal(again, first)
  assert.deepEqual(Object.keys(again), Object.keys(size), 'every list, in the order made')
  for (const name of Object.keys(size) as (keyof VsmListSizes)[])
    assert.equal(again[name], held[name], `${name} kept`)
})

test('the lights’ table goes up whole once, then only the words of a light that changed', () => {
  const fake = fakeDevice()
  const device = fake.device as unknown as GPUDevice
  const table = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const lights = [
    { firstId: 0, count: 17 },
    { firstId: 17, count: 6 },
    { firstId: 23, count: 6 },
  ]
  const words = () => new Uint32Array((table as unknown as { data: Uint8Array }).data.buffer, 0, 12)
  vsmWriteLights(device, table, lights)
  assert.deepEqual([...words()], [0, 17, 0, 0, 17, 6, 0, 0, 23, 6, 0, 0])
  const sent = fake.writes.length
  vsmWriteLights(device, table, lights)
  assert.equal(fake.writes.length, sent, 'a still frame sends nothing')
  vsmWriteLights(device, table, [lights[0], { firstId: 17, count: 7 }, lights[2]])
  assert.equal(fake.writes.length, sent + 1, 'a light that grew: one write')
  assert.equal(words()[5], 7)
})
