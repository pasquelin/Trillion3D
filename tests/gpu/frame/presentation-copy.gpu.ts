// The engine carries a display image to the screen and away from it exactly
// (`presentationCopyPage.ts`). Its presenter puts the image on the canvas every channel unchanged
// — one channel off would mean a colour conversion crept in —, at the image's size, and knows the
// canvas holds it (what lets a held frame encode nothing); its capture readback hands the image
// back with its rows bottom first, the convention the SDK publishes. Disposed, the presenter
// withdraws the image: the canvas is unconfigured.
//
//   node bench/dawn/proofs.ts tests/gpu/frame/presentation-copy.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import type { PresentationCopy } from './presentationCopyPage.ts'

test('the presenter and the capture copy a display image byte for byte', async () => {
  const page = (await loadPage(
    resolve(import.meta.dirname, 'presentationCopyPage.ts'),
    'presentationCopyPage',
  )) as typeof import('./presentationCopyPage.ts')
  const pageErrors: string[] = []
  const read = await runOnDawn(() => page.run(), null, pageErrors)
  console.log(JSON.stringify(read))
  assert.ok(!read.unavailable, 'no WebGPU adapter')
  assert.equal(read.error, undefined, 'the page ran to its end')
  const { capture, presented, size, holds, withdrawn } = read as PresentationCopy
  assert.deepEqual([...(read.errors ?? []), ...pageErrors], [])
  assert.deepEqual(size, [64, 48], 'the canvas is sized to the image')
  assert.equal(capture.bytes, 64 * 48 * 4)
  assert.equal(capture.channels, 0, `capture: ${capture.channels} channels off, ${capture.largest}`)
  assert.equal(
    presented.channels,
    0,
    `canvas: ${presented.channels} channels off, ${presented.largest}`,
  )
  assert.equal(holds, true, 'the presenter does not know the canvas holds the image')
  assert.equal(withdrawn, true, 'a disposed presenter leaves its image on the canvas')
})
