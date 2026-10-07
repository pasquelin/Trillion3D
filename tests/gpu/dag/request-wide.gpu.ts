// #1483: a request names any packed instance of an open world. It waits staged as two words — its
// page, then its priority — and `dagSortRequests` writes the page alone, a whole word, into the
// snapshot the frame copies (`gpu/dag/request.ts`). On Dawn, the shipped sort over requests past
// the twenty-two bits a word shared with the priority held: every page comes back whole, ranked.
import test from 'node:test'
import assert from 'node:assert/strict'
import { stagedRequestsWord } from '../../../packages/sdk-browser/src/gpu/dag/readoutWords.ts'
import {
  OUT_COUNT,
  SELECTION_HEADER_WORDS as HEAD,
} from '../../../packages/sdk-browser/src/gpu/dag/layout.ts'
import { requestScene } from '../../../packages/sdk-browser/src/gpu/dag/requestScene.fixture.ts'
import { readBuffer } from '../kit/computeReadback.ts'
import { runOnDawn } from '../kit/onDawn.ts'
import { openSelectionKernel } from './selectionKernel.ts'

/** Pages past twenty-two bits, each with its priority, in the order the threads staged them. */
const STAGED: [number, number][] = [
  [5, 3],
  [2 ** 22 + 7, 400],
  [2 ** 31 + 3, 511],
  [2 ** 32 - 2, 0],
  [123456789, 200],
]

/** `STAGED` sorted by the shipped kernel on the request scene's buffers: the snapshot's pages. */
async function sortOnDawn(staged: [number, number][]) {
  const kernel = await openSelectionKernel()
  const scene = requestScene(1, 64, 3)
  const selection = { name: 'sort', packed: scene.packed, uniforms: scene.uni }
  const { buffers, group, destroy } = kernel.bind(selection, (out, at) => {
    out[OUT_COUNT] = staged.length
    staged.forEach(([page, priority], s) => {
      out[stagedRequestsWord(at.listCap) + 2 * s] = page
      out[stagedRequestsWord(at.listCap) + 2 * s + 1] = priority
    })
  })
  kernel.sort(group)
  const read = await readBuffer(kernel.device, buffers.out.buffer, 0, (HEAD + staged.length) * 4)
  destroy()
  return { adapter: await kernel.close(), pages: Array.from(read.subarray(HEAD)) }
}

test('the snapshot names every page whole, past twenty-two bits, ranked by priority', async () => {
  const { adapter, pages } = await runOnDawn(sortOnDawn, STAGED)
  console.log(JSON.stringify({ adapter, pages }))
  const ranked = [...STAGED].sort((a, b) => b[1] - a[1]).map(([page]) => page)
  assert.deepEqual(pages, ranked)
})
