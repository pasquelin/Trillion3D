// #1521: a group of meshes the session composes on the GPU under its parent, the parent turned,
// moved or scaled while it runs, draws the image of a world opened with the parent already there —
// on the same session, never opened again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof, type PageProofResult } from '../kit/enginePageProof.ts'

interface Result extends PageProofResult {
  before?: string
  after?: string
  opened?: string
  sessions?: number[]
}

for (const [name, method] of [
  ['turned and moved', 'runTurn'],
  ['scaled, uniformly', 'runScale'],
  ['scaled unevenly and turned', 'runShear'],
  ['moved behind a wall', 'runBehind'],
  ['scaled under a light that casts', 'runShadows'],
] as const)
  test(`a rig of composed meshes ${name} draws as a world opened there`, async () => {
    const result = (await runPageProof(
      resolve(import.meta.dirname, 'composedParentPage.ts'),
      'composedParent',
      method,
    )) as Result
    assertSoundProof(result)
    assert.notEqual(result.after, result.before, 'the rig moved')
    assert.deepEqual(result.sessions, [1, 1], 'one session')
    assert.equal(result.after, result.opened, 'the image is the fresh open’s')
  })
