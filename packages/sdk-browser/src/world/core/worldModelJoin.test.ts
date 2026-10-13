// A model the scene gains joins the running session by the functions the open runs on its content:
// its cells first, then each source, one after the other; one the scene loses is parked, one it
// takes back is drawn again; one the session cannot take is said by name. The session is never
// asked to open again: no cause of a reopen is left but a lost device and an option.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { Primitive } from '../../../../sdk-core/src/index.ts'
import type { DrawSource } from '../../page/selection/drawSource.ts'
import type { LoadedModel } from './loadedModel.ts'
import { createModelJoins, type ModelSession } from './worldModelJoin.ts'
import { createWorldModels } from './worldModels.ts'
import { createWorldPoses } from './worldPoses.ts'
import { createWorldRanks } from './worldRanks.ts'
import { loadedModel, meshLinks } from './worldModels.fixture.ts'

/** A model of `count` meshes (`loadedModel`). */
const model = (
  count: number,
  textureSource: 'cache' | 'host' = 'host',
  partitions: object[] = [],
) => loadedModel(meshLinks(count), { textureSource, partitions }).loaded

/** The joins of a world on a scene, and a session that records what it is handed, in order. */
function world(refusal?: string) {
  const scene = new Object3D()
  const ranks = createWorldRanks(),
    models = createWorldModels(ranks),
    poses = createWorldPoses()
  const said: string[][] = [],
    calls: string[] = []
  const joins = createModelJoins({
    scene,
    models,
    poses,
    refused: (what, reason) => said.push([what, reason]),
  })
  const session: ModelSession = {
    growsInPlace: () => true,
    growPlacements() {},
    addPlacements: (source: DrawSource, primitive: Primitive) => (
      calls.push(`add ${source.mesh}/${primitive.mesh}`),
      Promise.resolve(refusal)
    ),
    preparePartitions: () => (calls.push('prepare'), Promise.resolve()),
    followPartitions: () => void calls.push('follow'),
    leavePartitions: () => void calls.push('leave'),
  }
  const members = new Set<LoadedModel>()
  const add = (loaded: LoadedModel) => (scene.add(loaded), members.add(loaded))
  return { joins, session, said, calls, members, add, scene, models }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('a model the scene gains is handed to the session, its cells first, then each source', async () => {
  const { joins, session, calls, members, add } = world()
  joins.opened([])
  const loaded = model(2, 'host', [{ pose() {} }])
  add(loaded)
  joins.reconcile(members, session)
  assert.ok(joins.flying, 'a join is in flight until the session has taken it')
  await joins.flying
  assert.deepEqual(calls, ['prepare', 'add 0/0', 'add 1/1', 'follow'])
  assert.equal(joins.flying, undefined)
})

test('a model the session was opened with is never handed to it again', async () => {
  const { joins, session, calls, members, add } = world()
  const loaded = model(2)
  add(loaded)
  joins.opened(members)
  joins.reconcile(members, session)
  assert.deepEqual([joins.flying, calls], [undefined, []])
})

test('no session, no join: the next opening takes the model', () => {
  const { joins, calls, members, add } = world()
  joins.opened([])
  add(model(1))
  joins.reconcile(members, undefined)
  assert.deepEqual([joins.flying, calls], [undefined, []])
})

test('a model the scene loses is parked, its cells let go, and drawn again when it comes back', () => {
  const { joins, session, calls, members, add, scene, models } = world()
  const loaded = model(2, 'host', [{ pose() {} }])
  add(loaded)
  joins.opened(members)
  const { rowed } = models.drawsOf(loaded)
  scene.updateMatrixWorld(true)
  models.pose(loaded, true)
  assert.deepEqual(
    rowed.map(({ rows }) => rows.live[0]),
    [1, 1],
  )
  members.delete(loaded)
  scene.remove(loaded)
  joins.reconcile(members, session)
  assert.deepEqual(
    rowed.map(({ rows }) => rows.live[0]),
    [0, 0],
    'its rows are down',
  )
  assert.deepEqual(calls, ['leave'])
  joins.reconcile(members, session)
  assert.deepEqual(calls, ['leave'], 'parked once')
  add(loaded)
  joins.reconcile(members, session)
  assert.deepEqual(calls, ['leave', 'follow'], 'its cells are followed again')
  assert.deepEqual(
    rowed.map(({ rows }) => rows.live[0]),
    [1, 1],
    'its rows are up',
  )
})

test('what the session refuses is said by name, the model is not handed again, and no reopen is asked', async () => {
  const { joins, session, said, calls, members, add } = world('KEY_PAGE_MAX')
  joins.opened([])
  add(model(2))
  joins.reconcile(members, session)
  await joins.flying
  assert.deepEqual(calls, ['add 0/0'], 'the join stops at the first source refused')
  assert.equal(said.length, 1)
  assert.match(said[0][0], /^the model file:\/\/\/cache\/manifest\.json/)
  assert.equal(said[0][1], 'KEY_PAGE_MAX')
  joins.reconcile(members, session)
  await flush()
  assert.equal(calls.length, 1, 'refused models wait for the next opening, not for each frame')
  assert.equal(said.length, 1, 'said once')
})

test('a model whose images were left to the cache is refused: only the session’s base reads them', async () => {
  const { joins, session, said, calls, members, add } = world()
  joins.opened([])
  add(model(1, 'cache'))
  joins.reconcile(members, session)
  await joins.flying
  assert.deepEqual(calls, [])
  assert.match(said[0][1], /left to the cache/)
})

test('a session that follows no partition refuses a model with cells, by name', async () => {
  const { joins, session, said, members, add } = world()
  joins.opened([])
  delete session.preparePartitions
  add(model(1, 'host', [{ pose() {} }]))
  joins.reconcile(members, session)
  await joins.flying
  assert.match(said[0][1], /follows no partition/)
})
