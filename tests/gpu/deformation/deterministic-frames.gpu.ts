// The skinned and morphed generated page of `deformationKernelCases.ts`, deformed over its fixed
// sequence of frames (the clock is the frame list: the same writes, the same order), twice on two
// devices: every frame's records are the same floats, bit for bit — the deformation draws nothing
// from time, memory order or a previous run.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { BUFFERS, FRAMES } from './deformationKernelCases.ts'
import type { run } from './deformationKernelPage.ts'

declare global {
  var deformationKernel: { run: typeof run }
}

/** The bits of each float of each frame's records, as hexadecimal words, NaN payloads included. */
const bitsOf = (records: number[][]) =>
  records.map((frame) => {
    const floats = Float32Array.from(frame)
    return Array.from(new Uint32Array(floats.buffer), (word) => word.toString(16))
  })

test('two runs of the same skinned and morphed frames give bit-identical records', async () => {
  await loadPage(resolve(import.meta.dirname, 'deformationKernelPage.ts'), 'deformationKernel')
  const pageErrors: string[] = []
  const runs = []
  for (let i = 0; i < 2; i++) {
    const { adapter, records, errors } = await runOnDawn(
      (input) => globalThis.deformationKernel.run(input),
      { buffers: BUFFERS, frames: FRAMES },
      pageErrors,
    )
    assert.deepEqual([...errors, ...pageErrors], [], `WebGPU errors on ${adapter}`)
    runs.push(bitsOf(records))
  }
  const [first, second] = runs
  assert.equal(first.length, FRAMES.length)
  assert.ok(
    new Set(first.map((frame) => frame.join())).size > 1,
    'the frames differ from one another: the proof is not a constant',
  )
  assert.deepEqual(second, first)
})
