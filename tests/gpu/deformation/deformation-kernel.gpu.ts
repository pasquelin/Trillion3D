// The engine's deformation kernel on a real GPU (`deformationKernelPage.ts`), over the layout of
// `deformationKernelCases.ts`: a compressed skinned and morphed page decoded in place, then the same
// three vertices as a dynamic float source whose previous position is the last image's, a soft
// source, a wave, and a whole copy skinned out of the float pool and written back into it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { OCT_SCALE } from '../../../packages/sdk-browser/src/cluster/format.ts'
import { DEFORM_VERTEX_WORDS } from '../../../packages/sdk-browser/src/deformation/slotLayout.ts'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { BUFFERS, FRAMES, MOVED, REST, waves } from './deformationKernelCases.ts'
import type { run } from './deformationKernelPage.ts'

declare global {
  var deformationKernel: { run: typeof run }
}

/** A vertex's record field — position at 0, previous position at 3, normal at 6 — in a frame. */
const field = (frame: number[], vertex: number, from: number) =>
  frame.slice(vertex * DEFORM_VERTEX_WORDS + from, vertex * DEFORM_VERTEX_WORDS + from + 3)

test('the deformation kernel decodes, deforms and keeps the history the engine declares', async () => {
  await loadPage(resolve(import.meta.dirname, 'deformationKernelPage.ts'), 'deformationKernel')
  const pageErrors: string[] = []
  const { adapter, records, errors } = await runOnDawn(
    (input) => globalThis.deformationKernel.run(input),
    { buffers: BUFFERS, frames: FRAMES },
    pageErrors,
  )
  assert.deepEqual([...errors, ...pageErrors], [], `WebGPU errors on ${adapter}`)
  const [skin, dynamic, moved, still, soft, waving, copied] = records
  for (let v = 0; v < 3; v++) {
    const rest = REST.slice(v * 3, v * 3 + 3)
    assert.deepEqual(field(skin, v, 0), [rest[0] + 2, rest[1], 1], `skin and morph, vertex ${v}`)
    assert.deepEqual(field(skin, v, 3), rest, `a first image's previous position is its rest one`)
    assert.deepEqual(field(dynamic, v, 3), rest, `dynamic source at rest, vertex ${v}`)
    assert.deepEqual(field(moved, v, 0), MOVED.slice(v * 3, v * 3 + 3), `moved, vertex ${v}`)
    assert.deepEqual(field(moved, v, 3), rest, `the previous position is the last image's`)
    assert.deepEqual(field(still, v, 3), field(still, v, 0), `held still, vertex ${v}`)
    assert.deepEqual(field(soft, v, 0), [rest[0], rest[1], 3], `soft source, vertex ${v}`)
    const offset = waves.offset(rest[0], rest[2], [])
    field(waving, v, 0).forEach((c, axis) =>
      assert.ok(Math.abs(c - rest[axis] - offset[axis]) < 0.01, `wave, vertex ${v}`),
    )
    // The whole copy deforms the float pool's exact normal, the page its octahedral one.
    assert.deepEqual(field(copied, v, 0), field(skin, v, 0), `whole copy, vertex ${v}`)
    assert.deepEqual(field(copied, v, 3), field(skin, v, 3), `whole copy history, vertex ${v}`)
    field(copied, v, 6).forEach((c, axis) =>
      assert.ok(Math.abs(c - field(skin, v, 6)[axis]) <= OCT_SCALE, `whole copy normal, ${v}`),
    )
  }
})
