// #1483: the GPU cut is the engine's one cut, whichever view draws. A capture of a second camera
// cuts on the main cut's tables with lists of its own (`gpu/dag/aside.ts`), and draws its own view
// of the scene; the main view, drawn again after it, holds the very image it held before: the
// aside cut left the main cut nothing to keep (`asideCutPage.ts`). No fallback is said.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, publishAndVerify } from '../kit/enginePageProof.ts'

interface Reading {
  scene: { held: boolean; red: number; bytes: number; main: number | null; moved: number | null }
}

test('a capture aside cuts on the GPU, and the main view holds its image after it', async () => {
  const reading = (await runPageProof(
    resolve(import.meta.dirname, 'asideCutPage.ts'),
    'asideCut',
    'runAsideCut',
  )) as Parameters<typeof publishAndVerify>[0] & Partial<Reading>
  publishAndVerify({ ...reading, passes: { scene: reading.scene } })
  const { scene } = reading as Reading
  assert.ok(scene.held, 'the main view is held before and after the capture')
  assert.equal(scene.bytes, 96 * 96 * 4)
  assert.ok(scene.red > 0, 'the capture draws the tile through its own cut')
  assert.ok(scene.moved && scene.moved > 0, 'the capture is of its own camera')
  assert.equal(scene.main, 0, 'the main view holds the image it held before the capture')
  const events = (reading.events ?? []) as { phase: string }[]
  assert.ok(!events.some((e) => /gpu-selection-(refused|fallback)/.test(e.phase)))
})
