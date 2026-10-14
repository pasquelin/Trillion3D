// A chunked raster's lists are its context's own buffers: a still frame asks for them again and
// gets the same record, nothing made — no list object, no buffer.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { vsmEnsureLists } from './chunkLists.ts'
import type { VsmListSizes } from './chunkSizing.ts'

test("the lists returned are the context's own buffers, the same record every frame", () => {
  const ctx = { device: fakeDevice().device as unknown as GPUDevice, buffers: {} }
  const size: VsmListSizes = {
    params: 512,
    views: 64,
    candidates: 64,
    counts: 64,
    cmds: 64,
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
