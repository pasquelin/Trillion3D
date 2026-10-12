// The placement tree's refit on the GPU (`gpu/dag/treeRefit.ts`) leaves the tree as the CPU build
// fits it, word for word, after poses moved a long way, parks, marks that open a group and a whole
// group parked — with the tables whole and with them split across buffers, bound the way the cut
// binds them. Only the groups the change touched and the nodes above them are written.
import test from 'node:test'
import assert from 'node:assert/strict'
import { runOnDawn } from '../kit/onDawn.ts'
import { runRefit } from './treeRefitRun.ts'

for (const split of [false, true])
  test(`the GPU refit is the CPU fit, word for word: tables ${split ? 'split in parts and ranges' : 'whole'}`, async () => {
    const result = await runOnDawn(runRefit, split)
    assert.ok(!('unavailable' in result), 'WebGPU must be available')
    assert.deepEqual(result.errors, [], 'no GPU error')
    assert.equal(result.differing, 0, `${result.differing} of ${result.compared} words differ`)
    assert.ok(result.untouched, 'the nodes outside the tree are never written')
  })
