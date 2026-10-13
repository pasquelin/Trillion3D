// #1521: a source added to a world's scene while its session runs — another material on the geometry
// the session already draws — joins the session in place (`placement/webgpuAppend.ts`): the session
// is not opened again, and its image is pixel for pixel the image of a world opened on both.
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

test('a second material on a held geometry joins the session in place and draws as a fresh open', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'appendInPlacePage.ts'),
    'appendInPlace',
  )) as Result
  assertSoundProof(result)
  assert.notEqual(result.after, result.before, 'the second batch appeared')
  assert.deepEqual(result.sessions, [1, 1], 'the session was never opened again')
  assert.equal(result.after, result.opened, 'the image is the fresh open’s')
})

test('a second geometry joins the session in place and draws as a fresh open', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'appendInPlacePage.ts'),
    'appendInPlace',
    'runGeometry',
  )) as Result
  assertSoundProof(result)
  assert.notEqual(result.after, result.before, 'the second geometry appeared')
  assert.deepEqual(result.sessions, [1, 1], 'the session was never opened again')
  assert.equal(result.after, result.opened, 'the image is the fresh open’s')
})
