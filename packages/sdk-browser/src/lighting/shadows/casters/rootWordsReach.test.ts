// The reach of a placement's deformation is a section of the placements' buffer of its own
// (`rootWords.ts`, `ROOT_SECTIONS`), the part of the mark's reach the maps that do not allow its
// offsets keep (`vsmBareReach`): written from the root, written again whenever it changes, and
// a placement the buffer does not hold has none to cap with.

import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { Matrix4 } from '../../../../../sdk-core/src/world/math/matrix4.ts'
import { createDeformationFrame } from '../../../deformation/frame.ts'
import { holdOffsetReach, holdReach } from '../../../deformation/halfFloat.ts'
import { deformationRuntime, unitRoot } from '../../../deformation/deformationRuntime.fixture.ts'
import type { PageRec } from '../../../geometry/selection/types.ts'
import { rootWordsTwin } from './rootWords.fixture.ts'
import { ROOT_SECTION, ROOT_SECTIONS, ROOT_WORDS_WGSL } from './rootWordsWgsl.ts'

const ROOTS = 4

test('the reach of each root’s deformation is written in the buffer’s fourth section, and again when it changes', () => {
  const { rt, roots, upload, reach, writes } = rootWordsTwin(ROOTS)
  upload()
  assert.deepEqual(reach(), [0, 0, 0, 0], 'none: nothing reaches')
  roots[1]!.deformReach = 2.5
  roots[3]!.deformReach = 7
  rt.lights.mobility.touch(1)
  rt.lights.mobility.touch(3)
  upload()
  assert.deepEqual(reach(), [0, 2.5, 0, 7])
  // One root’s reach changes: its entry alone goes up, in the three sections a run writes.
  roots[1]!.deformReach = 4
  rt.lights.mobility.touch(1)
  upload()
  assert.equal(
    writes.length,
    ROOT_SECTIONS - 1,
    'one run: a write for each section the host writes (all but the GPU’s state)',
  )
  assert.deepEqual(reach(), [0, 4, 0, 7])
  // A still scene writes nothing, and a reach that is no single-precision number is not sent again.
  roots[1]!.deformReach = 0.1
  rt.lights.mobility.touch(1)
  upload()
  reach()
  rt.lights.mobility.touch(1)
  upload()
  assert.equal(writes.length, 0, 'a repeat is not pushed')
})

test('a deformation’s reach marks its placement to be written; the offsets’ and a repeat do not', () => {
  const world = new Matrix4()
  const rec = { min: [-1, -1, -1], max: [1, 1, 1] } as unknown as PageRec
  const root = unitRoot(world, rec)
  const { rt } = deformationRuntime(world, createDeformationFrame([]), [root])
  const { mobility } = rt.lights
  const settle = () => mobility.writeRoots(() => {}, { castFlags: () => 0 })
  settle()
  assert.equal(mobility.touched, 0)
  holdReach(rt, 0, 3)
  assert.equal(mobility.touched, 1, 'the deformation reached further')
  settle()
  holdReach(rt, 0, 3)
  assert.equal(mobility.touched, 0, 'the same reach')
  holdOffsetReach(rt, 0, 2)
  assert.equal(mobility.touched, 0, 'the offsets’ part is not in the buffer’s section')
  assert.equal(root.reach, 5, 'the mark’s reach is their sum')
  holdReach(rt, 0, 4)
  assert.equal(mobility.touched, 1)
  // A reach that is not a number bounds nothing: one value, held and sent once.
  settle()
  holdReach(rt, 0, NaN)
  assert.equal(root.deformReach, Infinity)
  assert.equal(mobility.touched, 1)
  settle()
  holdReach(rt, 0, NaN)
  assert.equal(mobility.touched, 0, 'not touched again each frame')
})

test('a placement the buffer holds is capped by its deformation’s reach, any other by none', () => {
  const rootWords = new Array<number>(ROOT_SECTIONS * ROOTS).fill(0)
  rootWords[ROOT_SECTION.reach * ROOTS + 1] = new Uint32Array(new Float32Array([0.25]).buffer)[0]!
  const C = wgslConstants(ROOT_WORDS_WGSL)
  const { vsmRootWords, vsmBareReach } = shaderRun<{
    vsmRootWords(w: number): { deformReach: number; word: number; viewBits: number }
    vsmBareReach(roots: object, whole: number): number
  }>(ROOT_WORDS_WGSL, ['vsmRootWords', 'vsmBareReach'], {
    ...C,
    rootWords,
    arrayLength: (pointer: { get: () => unknown[] }) => pointer.get().length,
  })
  const held = vsmRootWords(1)
  assert.equal(held.deformReach, 0.25)
  assert.equal(vsmBareReach(held, 0.75), 0.25, 'the whole reach held to the deformation’s')
  assert.equal(vsmBareReach(held, 0.125), 0.125, 'never beyond the whole')
  // Past the buffer: no words, no view bits, no distance, and a reach that caps nothing.
  const absent = vsmRootWords(ROOTS)
  assert.deepEqual([absent.word, absent.viewBits], [0, 0])
  assert.equal(vsmBareReach(absent, 0.75), 0.75)
  // The unbounded extent as the shader holds it (an f32): the reach the cap leaves whole.
  assert.equal(vsmBareReach(absent, 1e15), C.UNBOUNDED_EXTENT)
})
