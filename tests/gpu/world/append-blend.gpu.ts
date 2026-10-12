// #1521: blended and transmissive geometries added to a world's scene while its session runs join
// the session in place (`placement/webgpuAppend.ts`, `webgpu/blend/growth.ts`): the session is not
// opened again, and its image is pixel for pixel the image of a world opened on all of them.
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

const page = resolve(import.meta.dirname, 'appendBlendPage.ts')
const prove = (method: string) => runPageProof(page, 'appendBlend', method) as Promise<Result>

for (const [name, method] of [
  ['a blended geometry the session does not hold', 'runBlended'],
  ['a transmissive geometry the session does not hold', 'runTransmissive'],
  ['a blended and a transmissive geometry, and a second material', 'runBoth'],
  ['a blended geometry in a session that draws none', 'runBlendedFirst'],
] as const)
  test(`${name} joins the session in place and draws as a fresh open`, async () => {
    const result = await prove(method)
    assertSoundProof(result)
    assert.notEqual(result.after, result.before, 'the added meshes appeared')
    assert.deepEqual(result.sessions, [1, 1], 'the session was never opened again')
    assert.equal(result.after, result.opened, 'the image is the fresh open’s')
  })

test('a transmissive geometry in a session opened without water opens the world again, as a fresh open', async () => {
  const result = await prove('runTransmissiveFirst')
  assertSoundProof(result)
  assert.notEqual(result.after, result.before, 'the added meshes appeared')
  assert.deepEqual(result.sessions, [1, 2], 'the water pass is made at the open')
  assert.equal(result.after, result.opened, 'the image is the fresh open’s')
})
