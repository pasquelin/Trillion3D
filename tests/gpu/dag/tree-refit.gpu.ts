// The placement tree's refit on the GPU (`gpu/dag/treeRefit.ts`) leaves the tree as the CPU build
// fits it, word for word, after poses moved a long way, parks, marks that open a group and a whole
// group parked — read and written in place in the tree's record table, a read-write storage
// texture (`treeTable.ts`), the frames in one range and in two. The tree's order beside the nodes is
// never written.
import test from 'node:test'
import assert from 'node:assert/strict'
import { runOnDawn } from '../kit/onDawn.ts'
import { runRefit } from './treeRefitRun.ts'

for (const split of [false, true])
  test(`the GPU refit is the CPU fit, word for word, in the tree's table: frames ${split ? 'in two ranges' : 'in one'}`, async () => {
    const result = await runOnDawn(runRefit, split)
    assert.ok(!('unavailable' in result), 'WebGPU must be available')
    assert.deepEqual(result.errors, [], 'no GPU error')
    assert.equal(result.differing, 0, `${result.differing} of ${result.compared} words differ`)
    assert.ok(result.untouched, 'the order beside the nodes is never written')
  })
