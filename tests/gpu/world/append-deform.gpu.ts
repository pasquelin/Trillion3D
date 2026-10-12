// #1521: meshes a skeleton, morph weights or waves move, and meshes whose vertices are read as floats,
// added to a world's scene while its session runs join the session in place
// (`placement/webgpuAppend.ts`, `deformation/growth.ts`): the session is not opened again, and its
// image is pixel for pixel the image of a world opened on all of them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof, type PageProofResult } from '../kit/enginePageProof.ts'

interface Result extends PageProofResult {
  before?: string
  after?: string
  opened?: string | string[]
  sessions?: number[]
}

const page = resolve(import.meta.dirname, 'appendDeformPage.ts')
const prove = (method: string) => runPageProof(page, 'appendDeform', method) as Promise<Result>

for (const [name, method] of [
  ['a skinned geometry in a session that moves nothing', 'runSkinnedFirst'],
  ['a skinned geometry in a session that moves skinned meshes', 'runSkinned'],
  ['more skinned meshes of a batch the session holds', 'runSkinnedRows'],
  ['a morphed geometry in a session that moves nothing', 'runMorphFirst'],
  ['morphed meshes, then more of them', 'runMorph'],
  ['a mesh the waves carry in a session that moves nothing', 'runWavedFirst'],
  ['more meshes the waves carry, and another sheet', 'runWavedRows'],
  ['a translucent mesh the waves carry', 'runWavedBlended'],
  ['a geometry read as floats', 'runFloats'],
  ['a skinned, a morphed, a waved and a float geometry, one after the other', 'runAll'],
] as const)
  test(`${name} joins the session in place and draws as a fresh open`, async () => {
    const result = await prove(method)
    assertSoundProof(result)
    assert.notEqual(result.after, result.before, 'the added meshes appeared')
    assert.deepEqual(result.sessions, [1, 1], 'the session was never opened again')
    assert.equal(result.after, result.opened, 'the image is the fresh open’s')
  })

test('rows of one batch posed differently draw each its own pose, stably', async () => {
  const result = (await prove('runPoses')) as Result & { opened: string[]; agree: boolean[] }
  assertSoundProof(result)
  assert.equal(
    new Set(result.opened).size,
    3,
    'two rows, either pose order, or alike: three images',
  )
  assert.deepEqual(result.agree, [true, true, true])
})
