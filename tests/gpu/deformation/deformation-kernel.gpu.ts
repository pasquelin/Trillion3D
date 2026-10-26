// The engine's deformation kernel on a real GPU (`deformationKernelPage.ts`), over the layout of
// `deformationKernelCases.ts`: a compressed skinned and morphed page decoded in place, then the same
// three vertices as a dynamic float source whose previous position is the last image's, a soft
// source and a wave.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFORM_VERTEX_WORDS } from '../../../packages/sdk-browser/src/deformation/vertexWords.ts'
import { MOVED, REST, waves } from './deformationKernelCases.ts'
import { deformationRecords } from './deformationKernelRun.ts'

/** A vertex's record field — position at 0, previous position at 3, normal at 6 — in a frame. */
const field = (frame: number[], vertex: number, from: number) =>
  frame.slice(vertex * DEFORM_VERTEX_WORDS + from, vertex * DEFORM_VERTEX_WORDS + from + 3)

test('the deformation kernel decodes, deforms and keeps the history the engine declares', async () => {
  const [skin, dynamic, moved, still, soft, waving] = await deformationRecords()
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
  }
})
