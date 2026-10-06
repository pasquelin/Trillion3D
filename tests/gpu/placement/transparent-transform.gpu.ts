// A transparent object moved by the public `setTransform` changes place in the image, paged as
// unpaged, by its own node as by its parent, under a sheared matrix, out of view and on return,
// including after the held image has settled (`transparentTransformPage.ts`). Out of view, the
// frustum rejects it and no draw is issued for it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, publishAndVerify, type PageProofResult } from '../kit/enginePageProof.ts'

interface Step {
  name: string
  red: boolean[]
  draws: number
  rejected: number
  held: boolean
}

interface Result extends PageProofResult {
  passes: Record<string, Step[]>
}

/** The page's three probes: left, right, top-right corner of the sheared tile. */
const [LEFT, RIGHT, CORNER] = [0, 1, 2]

test('a transparent follows setTransform, paged and unpaged', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'transparentTransformPage.ts'),
    'transparentTransform',
    'run',
  )) as Result
  publishAndVerify(result)
  for (const [pass, steps] of Object.entries(result.passes)) {
    const at = (name: string) =>
      steps.find((e) => e.name === name) ?? assert.fail(`${pass}: ${name} missing`)
    const say = (name: string, message: string) => `${pass} / ${name}: ${message}`
    const left = at('left')
    assert.ok(left.red[LEFT] && !left.red[RIGHT], say('left', 'the transparent is not on the left'))
    const right = at('right')
    assert.ok(right.red[RIGHT], say('right', 'setTransform did not move the transparent'))
    assert.ok(!right.red[LEFT], say('right', 'the transparent stayed on the left'))
    const parent = at('parent-left')
    assert.ok(parent.red[LEFT], say('parent-left', 'the parent does not carry its child'))
    assert.ok(!parent.red[RIGHT], say('parent-left', 'the child stayed on the right'))
    assert.ok(at('sheared').red[CORNER], say('sheared', 'the shear is lost at draw'))
    const out = at('out-of-view')
    assert.ok(!out.red[LEFT] && !out.red[RIGHT], say('out-of-view', 'the transparent stayed'))
    assert.ok(out.rejected >= 1, say('out-of-view', 'the frustum did not reject it'))
    assert.equal(out.draws, 0, say('out-of-view', 'draws were issued for it'))
    const back = at('back')
    assert.ok(back.red[LEFT], say('back', 'the transparent did not come back'))
    assert.ok(back.draws >= 1, say('back', 'no draw on its return'))
    assert.ok(
      steps.some((e) => e.name.startsWith('settling-') && e.held),
      say('settling', 'the image was never held: the after-hold proof would be empty'),
    )
    const after = at('after-hold')
    assert.equal(after.held, false, say('after-hold', 'the move did not break the held image'))
    assert.ok(after.red[RIGHT], say('after-hold', 'the new place is not shown'))
    assert.ok(!after.red[LEFT], say('after-hold', 'the old place is still painted'))
  }
})
