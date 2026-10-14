// The GPU's page→row map is the row cache's own table, followed by the slots it wrote: after every
// upload, the shader's probe on the uploaded words finds each page's row as the cache does, through
// growth, removals that shift runs back, and a cleared table.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { words } from '../../../../../tests/kit/gpu/fakeBuffers.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { createRowPageState } from './pageState.ts'
import { createRowMapGpu } from './rowMapGpu.ts'
import { rowOfPageIn } from './rowMap.fixture.ts'

test('the uploaded map answers every page as the cache does', () => {
  const { device } = fakeDevice()
  const state = createRowPageState(
    () => undefined,
    () => 1 << 20,
    () => -1,
  )
  const gpu = createRowMapGpu(device, state.rowMap.tables, state.rowMap.journal, (d) =>
    device.createBuffer(d),
  )
  const next = lcgRandom(5),
    seen = new Set<number>()
  let made = 0
  for (let step = 0; step < 4000; step++) {
    const page = next() < 0.5 ? Math.floor(next() * 128) : Math.floor(next() * 1e6)
    seen.add(page)
    const roll = next()
    if (roll < 0.6) state.setRowOf(page, step)
    else if (roll < 0.998) state.setRowOf(page, -1)
    else state.clearRows()
    if (step % 37 !== 0) continue
    if (gpu.upload()) made++
    const map = words((gpu.buffer as unknown as { data: Uint8Array }).data)
    for (const at of seen) assert.equal(rowOfPageIn(map, at), state.rowOf(at), `page ${at}`)
  }
  assert.ok(made > 1, 'the buffer was made anew as the table grew')
})

test('an upload with nothing written sends nothing', () => {
  const { device, writes } = fakeDevice()
  const state = createRowPageState(
    () => undefined,
    () => 16,
    () => -1,
  )
  const gpu = createRowMapGpu(device, state.rowMap.tables, state.rowMap.journal, (d) =>
    device.createBuffer(d),
  )
  state.setRowOf(3, 7)
  gpu.upload()
  const sent = writes.length
  assert.equal(gpu.upload(), false)
  assert.equal(writes.length, sent)
  state.setRowOf(3, 8)
  gpu.upload()
  assert.equal(writes.length, sent + 2, 'one slot: its key and its value')
})
