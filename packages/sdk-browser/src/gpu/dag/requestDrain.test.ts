// The GPU REQUEST DRAIN (#478): the cut stages its requests in the order its threads win the
// counter, `dagSortRequests` writes them into the snapshot by `requestRank`, and the host reads them
// in that order. Run on the Node device, which replays the kernels through their CPU mirrors.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { createGpuDagSelection } from './selection.ts'
import { requestScene } from './requestScene.fixture.ts'
import { SELECTION_HEADER_WORDS } from './layout.ts'
import { REQUEST_STEP_MAX } from './request.ts'
import { sortStaged, stagedPage, stagedRank, stagedRequest } from './request.fixture.ts'
import { evaluateDagSelectionKernel } from './oracle/oracle.fixture.ts'

test('the requests reach the host in requestRank order, sorted by the GPU', async () => {
  installGpuGlobals()
  const { packed, uni: uniforms } = requestScene(1, 1024, 6)
  const gpu = mockGpu({ packed })
  const selection = await createGpuDagSelection(gpu.device, packed)
  assert.ok(selection)
  selection.dispatch(uniforms)
  const result = await selection.flush()
  const oracle = evaluateDagSelectionKernel(packed, uniforms)
  // The threads' order is not the rank's: the sort has work to do.
  const staged = oracle.requestWords
  assert.ok(staged.some((word, i) => i > 0 && stagedRank(word) > stagedRank(staged[i - 1])))
  // What the frame copies is the pages of the sorted list, one whole word each, rank never rising.
  const out = gpu.buffers.find((buffer) => buffer.label === 'Trillion3D DAG readback')!
  const words = new Uint32Array(out.data.buffer).subarray(
    SELECTION_HEADER_WORDS,
    SELECTION_HEADER_WORDS + staged.length,
  )
  assert.ok(words.length > 100, 'the cut must keep enough to rank')
  assert.deepEqual([...words], sortStaged(staged).map(stagedPage))
  // And the host reads it as it came: the kernel mirror's order, page for page.
  assert.deepEqual(result?.pageIds, oracle.pageIds)
  selection.dispose()
})

test('the sort mirror keeps every word through massive ties at both ends of the range', () => {
  // A counting sort breaks where a comparison sort does not: at both ends of the range, and when
  // almost every word falls in one rank. This list pushes both at once.
  const STEPS = [0, 1, REQUEST_STEP_MAX - 1, REQUEST_STEP_MAX]
  const words = Array.from({ length: 4000 }, (_, i) => stagedRequest(i, STEPS[i % STEPS.length]))
  const sorted = sortStaged(words)
  assert.deepEqual([...sorted].sort(), [...words].sort(), 'every word once')
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(stagedRank(sorted[i]) <= stagedRank(sorted[i - 1]), `rank ${i} rises`)
    // Within a rank, the order the words came in.
    if (stagedRank(sorted[i]) === stagedRank(sorted[i - 1]))
      assert.ok(stagedPage(sorted[i]) > stagedPage(sorted[i - 1]))
  }
})
