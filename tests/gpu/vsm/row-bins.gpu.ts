// The shadow raster's chunk bound on the device's histograms (`vsm/rowBinsWgsl.ts`): an oblique low
// sun and a spot over a dense scene, half its rows moving, binned on the GPU and read back; the
// moving rows then travel within the margin they were binned at, then far past it. The bound never
// falls below the exact count of the shipped cull, for any K, any frame. How far the device's bins
// are from the CPU's single-precision steps (a fused multiply-add moves a row across an edge) is
// printed: the room the bins hold covers it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { runOnDawn } from '../kit/onDawn.ts'
import { runRowBins } from './rowBinsRun.ts'

test('the chunk bound never under-counts on an oblique dense moving scene', async () => {
  const result = await runOnDawn(runRowBins, undefined)
  assert.ok(!('unavailable' in result), 'a WebGPU adapter')
  assert.deepEqual(result.errors, [], 'no GPU error')
  if (!('short' in result)) return
  console.log(`bins apart from the CPU's: ${result.binsDiffer}; moving rows ${result.movingRows}`)
  assert.equal(result.movingRows, 1500)
  assert.deepEqual(result.short, [0, 0, 0, 0], 'no K under the exact count, every frame')
})
