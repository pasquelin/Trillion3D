// One run of the deformation kernel page on Dawn (`deformationKernelPage.ts`) over the layout of
// `deformationKernelCases.ts`: what both deformation proofs read.
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { BUFFERS, FRAMES } from './deformationKernelCases.ts'
import type { run } from './deformationKernelPage.ts'

declare global {
  var deformationKernel: { run: typeof run }
}

/** Every frame's records of one run of the kernel, a WebGPU error refused. */
export async function deformationRecords() {
  await loadPage(resolve(import.meta.dirname, 'deformationKernelPage.ts'), 'deformationKernel')
  const pageErrors: string[] = []
  const { adapter, records, errors } = await runOnDawn(
    (input) => globalThis.deformationKernel.run(input),
    { buffers: BUFFERS, frames: FRAMES },
    pageErrors,
  )
  assert.deepEqual([...errors, ...pageErrors], [], `WebGPU errors on ${adapter}`)
  return records
}
