// `hold.ts` lets a frame hold once the bounce series has closed (`working` false). That loses
// no image only if a closed series writes nothing more: every probe and the
// grid uniform a redraw would read are then the ones the held frame read, so the redraw would
// draw the same pixels. Driven here on the engine's own probes, over a recording device.
import test from 'node:test'
import assert from 'node:assert/strict'
import { floorProbes } from './floorProbes.fixture.ts'

test('a closed bounce series encodes and writes nothing: a redraw reads what the held frame read', async () => {
  const { gpu, probes, encoder } = await floorProbes()
  const eye = [4, 4, 2]
  let frames = 0
  while (probes.working) {
    assert.ok(++frames < 100_000, 'the series closes')
    probes.encode(encoder, 1, eye)
  }
  assert.ok(gpu.dispatches.length > 0, 'the series traced probes before it closed')
  const writes = gpu.writes.length,
    encoded = gpu.commands.length
  for (let frame = 0; frame < 8; frame++) assert.equal(probes.encode(encoder, 1, eye), false)
  assert.deepEqual(gpu.commands.slice(encoded), [], 'no pass, copy or clear once closed')
  assert.equal(gpu.writes.length, writes, 'no buffer written once closed')
  assert.equal(probes.working, false)
})
