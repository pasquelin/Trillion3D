// A model the scene gains joins the running session by the functions the open runs on its content:
// its cells first, then each source, one after the other; one the scene loses is parked, one it
// takes back is drawn again; one the session cannot take is said by name. The session is never
// asked to open again: no cause of a reopen is left but a lost device and an option.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts'
import type { Primitive } from '../../../../../sdk-core/src/contracts/geometry.ts'
import type { DrawSource } from '../../../geometry/selection/drawSource.ts'
import { placeModel, placementIndex, type LoadedModel } from './loadedModel.ts'
import { createModelJoins, type ModelSession } from './modelJoin.ts'
import { createWorldModels } from './models.ts'
import { createWorldPoses } from '../poses/poses.ts'
import { createWorldRanks } from '../ranks.ts'
import { loadedModel, meshLinks } from './models.fixture.ts'

/** A model of `count` meshes (`loadedModel`). */
const model = (count: number, partitions: object[] = []) =>
  loadedModel(meshLinks(count), { partitions }).loaded

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
    growPlacements: (from, to) => void calls.push(`grow ${from.capacity}→${to.capacity}`),
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
  const loaded = model(2, [{ pose() {} }])
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
  const loaded = model(2, [{ pose() {} }])
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

test('a session that follows no partition refuses a model with cells, by name', async () => {
  const { joins, session, said, members, add } = world()
  joins.opened([])
  delete session.preparePartitions
  add(model(1, [{ pose() {} }]))
  joins.reconcile(members, session)
  await joins.flying
  assert.match(said[0][1], /follows no partition/)
})

test('a placement of a record the session holds adds a row alone, and leaves alone', async () => {
  const { joins, session, calls, members, add, scene, models } = world()
  joins.opened([])
  const first = model(2)
  add(first)
  joins.reconcile(members, session)
  await joins.flying
  // The same manifest placed again: the same record, read once — its graph, images and pages.
  const second = placeModel(first)
  assert.deepEqual([second.record === first.record, placementIndex(second)], [true, 1])
  assert.equal(placementIndex(placeModel(second)), 2, 'placed from any placement, ranked after')
  second.position.set(100, 0, 0)
  add(second)
  calls.length = 0
  joins.reconcile(members, session)
  await joins.flying
  // No source, primitive, page nor image handed again: each source grows a row, in place.
  assert.deepEqual(calls, ['grow 1→2', 'grow 1→2'])
  const drawn = models.drawsOf(first)
  assert.equal(models.drawsOf(second), drawn, 'one set of sources for every placement')
  scene.updateMatrixWorld(true)
  models.pose(first, true)
  models.pose(second, true)
  const rows = drawn.rowed[0].rows,
    x = (row: number) => rows.matrices[16 * row + 12]
  assert.deepEqual(
    [x(0), x(1), rows.live[0], rows.live[1]],
    [0, 100, 1, 1],
    'each at its own world',
  )
  // The second leaves: its row is parked, the first's drawn still.
  members.delete(second)
  scene.remove(second)
  joins.reconcile(members, session)
  assert.deepEqual([rows.live[0], rows.live[1]], [1, 0])
  assert.deepEqual(calls, ['grow 1→2', 'grow 1→2'], 'nothing let go that the first draws')
})
