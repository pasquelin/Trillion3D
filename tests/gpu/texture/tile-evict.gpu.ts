// A full tile pool's victims are the places no pixel read (`webgpu/tile/stampWgsl.ts`,
// `evictSortWgsl.ts`, `evictSort.ts`): the feedback reduction stamps the place each asked tile's
// entry names — the ancestor a streaming child's pixels read included —, the sort ranks the pool on
// those stamps, and the queue the feedback readback brings back lists every other streamed place,
// never a tail, never a place read.
//
//   node bench/dawn/proofs.ts tests/gpu/texture/tile-evict.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'

type Page = typeof import('./tileEvictPage.ts')

const page = async () =>
  (await loadPage(resolve(import.meta.dirname, 'tileEvictPage.ts'), 'tileEvictPage')) as Page

test('the victims of a full pool are the streamed places no pixel read, the ancestor kept', async () => {
  const { run } = await page()
  const { adapter, errors, victims, kept, tiles } = await runOnDawn(run, {
    width: 64,
    height: 16,
    read: 500,
    frames: 6,
  })
  assert.deepEqual(errors, [], `WebGPU errors on ${adapter}`)
  assert.equal(kept.length, 501, 'the 500 tiles read and the ancestor of the child')
  assert.equal(new Set(victims).size, victims.length, 'a place once')
  for (const index of kept) assert.ok(!victims.includes(index), `place ${index} was read`)
  assert.equal(victims.length, tiles - 1 - kept.length, 'every other place but the tail')
})
