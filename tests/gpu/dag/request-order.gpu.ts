// The request list leaves the GPU already ranked: the shipped kernel (`dagSortRequests`) writes the
// camera's requests by the SUBSTITUTE's screen error, the costliest absence first, and the host
// reads them in that order and ranks nothing (`gpu/dag/request.ts`). On the four-depth scene of
// the request tests, the order the device publishes is checked against `clusterErrorPixels`
// recomputed in f64: never more than one quantization step out of order, the head the costliest.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  orderFault,
  REQUEST_STEP,
  requestScene,
  substitutePixels,
} from '../../../packages/sdk-browser/src/gpu/dag/requestScene.fixture.ts'
import { runSelectionKernel } from './selectionKernel.ts'

test('the kernel publishes its requests ranked by the substitute’s screen error', async () => {
  const scene = requestScene(1)
  const { adapter, readings } = await runSelectionKernel([
    { name: 'four depths', packed: scene.packed, uniforms: scene.uni },
  ])
  const pixelsOf = substitutePixels(scene)
  // The snapshot holds the page alone, one word a request, ranked by the kernel.
  const pixels = readings[0].requests.map((page) => pixelsOf(page))
  console.log(JSON.stringify({ adapter, requests: pixels.length }))
  assert.ok(pixels.length > 100, 'the cut must keep enough to rank')
  assert.ok(new Set(pixels.map((p) => p.toFixed(3))).size > 8, 'the cut must carry varied errors')
  const fault = orderFault(pixels)
  assert.equal(fault, -1, `rank ${fault}: ${pixels[fault]} px past ${pixels[fault - 1]} px`)
  assert.ok(pixels[0] * REQUEST_STEP >= Math.max(...pixels), 'the head is not the most expensive')
})
