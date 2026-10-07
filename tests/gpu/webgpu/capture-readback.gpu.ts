// The capture reads the engine's image back on the GPU, never through a canvas: one texture copy
// into a mapped buffer, its padded rows glued back byte for byte, bottom row first (a level's, top
// row first, as the proofs read them); and a frame no flush settled is read back by the capture
// itself, the very image its flush then reads (`captureReadbackPage.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, publishAndVerify } from '../kit/enginePageProof.ts'

interface Reading {
  padded: { bytes: number; different: number; level: { bytes: number; different: number } }
  scene: { held: boolean; red: number; bytes: number; moved: number | null; difference: number }
}

test('a capture copies the image back exactly, with or without a flush before it', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'captureReadbackPage.ts'),
    'captureReadback',
    'runCaptureReadback',
  )) as Parameters<typeof publishAndVerify>[0] & Partial<Reading>
  publishAndVerify({ ...reading, passes: { padded: reading.padded, scene: reading.scene } })
  const { padded, scene } = reading as Reading
  assert.deepEqual(
    padded,
    { bytes: 67 * 5 * 4, different: 0, level: { bytes: 33 * 2 * 4, different: 0 } },
    'the padded rows read exactly, bottom first; a level read top first',
  )
  assert.ok(scene.held, 'the first view is held')
  assert.equal(scene.bytes, 96 * 96 * 4)
  assert.ok(scene.red > 0, 'the tile is in the unflushed capture')
  assert.ok(scene.moved && scene.moved > 0, 'the capture is of the slid view, not the held one')
  assert.equal(scene.difference, 0, 'the unflushed capture is the image the flush reads')
})
