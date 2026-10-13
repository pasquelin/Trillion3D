// What the append-in-place proofs share on the test side: each case of a page is proved by running
// its method on Dawn, the added meshes appearing, the session never opened again, and the image
// the one of a world opened on all of them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof, type PageProofResult } from '../kit/enginePageProof.ts'

interface AppendResult extends PageProofResult {
  before?: string
  after?: string
  opened?: string | string[]
  sessions?: number[]
}

/** Registers a test for each `[name, method]` of the page `file` (beside the caller), proved under
 *  the global name `global`. */
export function appendCases(
  file: string,
  global: string,
  cases: readonly (readonly [string, string])[],
) {
  const page = resolve(import.meta.dirname, file)
  for (const [name, method] of cases)
    test(`${name} joins the session in place and draws as a fresh open`, async () => {
      const result = (await runPageProof(page, global, method)) as AppendResult
      assertSoundProof(result)
      assert.notEqual(result.after, result.before, 'the added meshes appeared')
      assert.deepEqual(result.sessions, [1, 1], 'the session was never opened again')
      assert.equal(result.after, result.opened, 'the image is the fresh open’s')
    })
}
