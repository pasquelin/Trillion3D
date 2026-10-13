// A real world runtime on Dawn: models, batches, a blended and a deformed batch and meshes linked
// under a moved parent, opened through `buildWorldSource` and drawn from three fixed cameras. The
// image of each is digested (8-bit RGBA) and must be the golden one (`openWorld.golden.json`): what
// the world's session is built from may change, what it draws may not. Recorded with
// `TRILLION3D_RECORD_GOLDEN=1`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof, type PageProofResult } from '../kit/enginePageProof.ts'

interface Result extends PageProofResult {
  hashes?: string[]
  drawn?: number[]
  unheld?: number[]
  reopens?: number
}

const GOLDEN = resolve(import.meta.dirname, 'openWorld.golden.json')

test('an open world draws the frames it drew, pixel for pixel', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'openWorldPage.ts'),
    'openWorld',
  )) as Result
  assertSoundProof(result)
  assert.deepEqual(result.unheld, [], 'every frame was held')
  assert.ok(
    result.drawn!.every((n) => n > 2000),
    `the scene is drawn: ${result.drawn}`,
  )
  assert.equal(new Set(result.hashes).size, result.hashes!.length, 'the cameras differ')
  if (process.env.TRILLION3D_RECORD_GOLDEN || !existsSync(GOLDEN))
    return writeFileSync(GOLDEN, JSON.stringify({ hashes: result.hashes }, null, 2) + '\n')
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { hashes: string[] }
  assert.deepEqual(result.hashes, golden.hashes)
})
