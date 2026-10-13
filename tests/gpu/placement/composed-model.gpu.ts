// #1521: a compiled model the session composes on the GPU — its rows the model's world times each
// mesh's —, moved, scaled or turned while it runs, a bone of it bent, draws the image of a world
// opened with the model already there: the same session, never opened again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof, type PageProofResult } from '../kit/enginePageProof.ts'

interface Result extends PageProofResult {
  after?: string
  opened?: string
  sessions?: number[]
}

for (const [name, method] of [
  ['a dense sphere moved, scaled and turned', 'runSphere'],
  ['a skinned tube moved with its knee bent', 'runSkinned'],
  ['a crowd cut in cells moved', 'runCells'],
] as const)
  test(`${name}: its image is a world opened there's`, async () => {
    const result = (await runPageProof(
      resolve(import.meta.dirname, 'composedModelPage.ts'),
      'composedModel',
      method,
    )) as Result
    assertSoundProof(result)
    assert.deepEqual(result.sessions, [1, 1], 'one session')
    assert.equal(result.after, result.opened, 'the image is the fresh open’s')
  })
