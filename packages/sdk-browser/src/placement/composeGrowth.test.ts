// A growth appends roots behind those a parent composes: every link stays, the new roots link as
// any; a list shortened unlinks every root through the one unlink path. On a generated session of
// two composed roots, grown root by root to forty.
import test from 'node:test'
import assert from 'node:assert/strict'
import { composeWebgpuPlacements } from './gpuCompose.ts'
import { NONE } from './gpuComposeWgsl.ts'
import { createPlacementRows } from './rows.ts'
import { forgetRowRoots } from './update.ts'
import { session, turn } from './composeSession.fixture.ts'

test('a growth keeps every link; a shortened list unlinks them all', () => {
  const { rt, rows, frame } = session()
  const roots = rt.layout.selectionRoots as unknown as object[],
    unlinked: number[] = []
  rt.run.gpuSelection = {
    ...rt.run.gpuSelection!,
    composedPlacement: (w: number, composed: boolean) => void (!composed && unlinked.push(w)),
  }
  const first = {}
  composeWebgpuPlacements(
    rt,
    first,
    turn(0),
    [0, 1].map((index) => ({ rows, index, local: turn(0) })),
    true,
  )
  frame()
  // Roots appended one by one, each placed by rows of its own: a second parent links the last.
  for (let k = 2; k < 40; k++) {
    const own = createPlacementRows(1)
    roots.push({
      placement: { rows: own, index: 0 },
      world: { elements: new Float32Array(turn(k)) },
    })
    // As a growth adopts its roots (`webgpuGrownCut.ts`): the rows' index is built again.
    forgetRowRoots(roots)
    if (k === 39)
      composeWebgpuPlacements(rt, {}, turn(1), [{ rows: own, index: 0, local: turn(0) }], true)
  }
  const parentOf = rt.compose!.parentOf
  assert.deepEqual([parentOf[0], parentOf[1]], [0, 0], 'the first parent still poses its two')
  assert.equal(parentOf[39], 1, 'the new root follows its own parent')
  assert.ok(parentOf.subarray(2, 39).every((p) => p === NONE))
  assert.deepEqual(unlinked, [], 'nothing unlinked')
  // Another, shorter list: every root unlinked, through the one path.
  roots.length = 2
  forgetRowRoots(roots)
  composeWebgpuPlacements(rt, first, turn(0), [], false)
  assert.deepEqual(
    unlinked.sort((a, b) => a - b),
    [0, 1, 39],
  )
})
