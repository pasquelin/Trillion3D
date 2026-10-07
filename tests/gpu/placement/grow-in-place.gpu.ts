// #1483: a partition whose view needs one more node than its rows hold grows them under the running
// WebGPU session — its GPU cut made again over the grown rows beside the running one, swapped in
// between two images (`placement/webgpuGrowth.ts`) — instead of opening the session again. On a
// real device the session keeps going (no reopen: the growth is taken in place) and its image, once
// the new placement lands, is pixel for pixel the image of a session opened on the grown rows
// (`growInPlacePage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, publishAndVerify, type PageProofResult } from '../kit/enginePageProof.ts'

interface Result extends PageProofResult {
  reading?: {
    inPlace: boolean
    capacity: number
    beforePixels: number
    afterPixels: number
    grownFromBefore: number
    grownFromOpened: number
  }
}

test('rows grown past their capacity keep the WebGPU session and draw its image', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'growInPlacePage.ts'),
    'growInPlace',
    'run',
  )) as Result
  publishAndVerify({ ...result, passes: result.reading })
  const reading = result.reading!
  assert.equal(reading.inPlace, true, 'the session refused the growth: it would be opened again')
  assert.ok(reading.capacity >= 3, 'the rows grew')
  assert.ok(reading.grownFromBefore > 0, 'the third placement never appeared')
  assert.ok(reading.afterPixels > reading.beforePixels, 'the grown image draws one tile more')
  assert.equal(reading.grownFromOpened, 0, 'the grown image differs from a session opened on it')
})
