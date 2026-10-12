// #1521: compiled models added to a world's scene while its session runs — a second model, one
// whose coplanar layers the session was opened without, a crowd cut in cells a partition reads by
// distance — join the session in place (`world/core/worldModelJoin.ts`): the session is not opened
// again, and its image is pixel for pixel the image of a world opened on all of them. A model that
// leaves the scene is parked, and drawn again where the scene takes it back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { runPageProof, assertSoundProof, type PageProofResult } from '../kit/enginePageProof.ts'
import { appendCases } from './appendCases.ts'

appendCases('appendModelsPage.ts', 'appendModels', [
  ['a second model', 'run'],
  ['a model with coplanar layers the session has no slots for', 'runLayers'],
  ['two models, one after the other', 'runTwo'],
  ['a model in a session that draws meshes alone', 'runFirst'],
  ['a model a stream unit holds', 'runSmall'],
  ['a model cut in cells, beside a model', 'runPartitioned'],
  ['a model cut in cells, in a session that draws meshes alone', 'runPartitionedFirst'],
])

interface RemovedResult extends PageProofResult {
  full?: string
  without?: string
  back?: string
  bare?: string
  sessions?: number[]
}

test('a model the scene loses is parked, drawn again where the scene takes it back, one session', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'appendModelsPage.ts'),
    'appendModels',
    'runRemoved',
  )) as RemovedResult
  assertSoundProof(result)
  assert.notEqual(result.without, result.full, 'the crowd left the image')
  assert.equal(result.without, result.bare, 'the image is that of a world without it')
  assert.equal(result.back, result.full, 'the crowd is drawn again, as it was')
  assert.deepEqual(result.sessions, [1, 1], 'the session was never opened again')
})

test('a model with its world DAG joins the session in place: its far cells are drawn by the DAG, as a fresh open draws them', async () => {
  const result = (await runPageProof(
    resolve(import.meta.dirname, 'appendModelsPage.ts'),
    'appendModels',
    'runWorldDag',
  )) as PageProofResult & {
    before: string
    after: string
    opened: string
    sessions: number[]
    clusters: number[]
  }
  assertSoundProof(result)
  assert.notEqual(result.after, result.before, 'the crowd appeared')
  assert.deepEqual(result.sessions, [1, 1], 'the session was never opened again')
  assert.equal(result.after, result.opened, 'the image is the fresh open’s')
  // Two thousand four hundred objects drawn each by its own clusters would be at least that many:
  // the cells are held far, drawn by the world DAG, in the session that joined as in the one opened.
  for (const drawn of result.clusters) assert.ok(drawn < 2400, `${result.clusters} clusters`)
})
