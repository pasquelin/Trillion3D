// The scene trace's table past the file's records (`sceneTraceResources.ts`): the placements of the world DAG, the words of its cells, and
// the file whose actors name a cell the cut does not pack.

import test from 'node:test'
import assert from 'node:assert/strict'
import { NO_INDEX } from '../../../../../math/src/constants.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { words } from '../../../../../../tests/kit/fakeDevice/fakeBuffers.ts'
import { destroyRetired } from '../../../gpu/core/frameRetire.ts'
import { ensureSceneTrace, sceneTraceWords, type TracedWorld } from './sceneTraceResources.ts'
import { SCENE_TRACE_PARAMS } from './sceneTraceWgsl.ts'
import {
  CULLING,
  WORLD,
  drawn,
  fileOf,
  tableOf,
  worldFileOf,
  worldOf,
} from './sceneTraceTable.fixture.ts'

test('the table has room for a word for each cell of each instance of the world DAG, when the file has its directory', () => {
  const world = worldOf(40, 2, () => false)
  // Two instances of forty words each, after the four words of records and the placements' room.
  assert.deepEqual(sceneTraceWords(worldFileOf(), 3, world), {
    nodes: 8,
    triangles: 12,
    corners: 4,
    table: 4 + 8 + 80,
  })
  assert.deepEqual(
    sceneTraceWords(fileOf(), 3, world),
    sceneTraceWords(fileOf(), 3),
    'no directory: none',
  )
  assert.equal(sceneTraceWords(worldFileOf(), 3).table, 4 + 8, 'no world in the cut: none')
  // A third instance rounds to four.
  const three = worldOf(40, 3, () => false)
  assert.equal(sceneTraceWords(worldFileOf(), 3, three).table, 4 + 8 + 160)
  const { device } = fakeDevice()
  const file = worldFileOf()
  const kept = ensureSceneTrace(undefined, device, file, 3, world).sceneTrace!
  assert.equal(ensureSceneTrace(kept, device, file, 3, world).sceneTrace, kept)
  assert.notEqual(ensureSceneTrace(kept, device, file, 3, three).sceneTrace, kept, 'outgrown')
  const fewer = worldOf(40, 1, () => false)
  assert.equal(
    ensureSceneTrace(kept, device, file, 3, fewer).sceneTrace,
    kept,
    'a world that shrinks keeps its room',
  )
  // A frame whose cut packs no world DAG, or has no cell states, keeps the room instead of making the resources twice.
  const bare = { world: undefined, cellStates: undefined } as unknown as TracedWorld
  const stateless = { world: { draws: () => false } } as unknown as TracedWorld
  for (const silent of [undefined, bare, stateless])
    assert.equal(
      ensureSceneTrace(kept, device, file, 3, silent).sceneTrace,
      kept,
      'a cut without its world for a frame keeps the room',
    )
  assert.equal(
    ensureSceneTrace(kept, device, file, 3, world).sceneTrace,
    kept,
    'and the next frame',
  )
})

test('a placement of the world DAG is the directory at its instance; a cell’s word is whether the cut draws it and the object a hit is told by', () => {
  const { device } = fakeDevice()
  const world = worldOf(3, 2, (k, cell) => (k === 0 && cell === 1) || (k === 1 && cell === 2))
  const file = worldFileOf()
  const trace = ensureSceneTrace(undefined, device, file, 4, world).sceneTrace!
  const roots = [{ mesh: 3, primitive: 5 }, { hlod: {} }, {}, { hlod: {} }]
  trace.syncPlacements(roots, world)
  // The records, the four placements, then two instances' three cells: the drawn ones, with no object told yet;
  // last the four words of the culling, none left out before the culling pass.
  assert.deepEqual(tableOf(trace), [
    ...[7, 8, 9, 10],
    ...[2, WORLD, NO_INDEX, (WORLD | 1) >>> 0],
    ...[0, drawn(), 0],
    ...[0, 0, drawn()],
    ...[0, 0, 0, 0],
  ])
  // The stand-ins the surface cache follows after the cut's roots tell the objects: a rank among its roots, the cell's
  // stand-in in the instance; one for a cell the cut does not draw, or a root that stands for nothing, tells none.
  const standIn = (instance: number, cell: number) => ({
    standsFor: 1,
    instance,
    field: { mesh: cell },
  })
  const cacheRoots = [...roots, standIn(0, 1), {}, standIn(1, 2), standIn(1, 0)]
  trace.syncPlacements(roots, world, cacheRoots)
  assert.deepEqual(tableOf(trace).slice(8, 14), [0, drawn(4), 0, 0, 0, drawn(6)])
  // The cut draws other actors: only the words are written again.
  const moved = worldOf(3, 2, (k, cell) => k === 0 && cell === 0)
  trace.syncPlacements(roots, moved, cacheRoots)
  assert.deepEqual(tableOf(trace).slice(8, 14), [drawn(), 0, 0, 0, 0, 0])
  // The parameters name the directory, where the cells' words begin and how many an instance holds.
  trace.writeParams({
    eye: [0, 0, 0],
    treeRoot: 0,
    maxIterations: 1,
    skipBackFaceDistance: 0,
    skipTwoSidedDistance: 0,
    skipsTranslucentSections: true,
    culling: CULLING,
  })
  const P = SCENE_TRACE_PARAMS.at
  const written = words((trace.params as unknown as { data: Uint8Array }).data)
  assert.deepEqual(
    [written[P.worldRecord], written[P.cellsWord], written[P.cells], written[P.placementWord]],
    [1, 4 + 4, 3, 4],
  )
  // The words of the culling follow the cells' words: two instances of three cells.
  assert.equal(written[P.cullWord], 4 + 4 + 6)
})

test('a world root the table has no room for in its cells’ words, or a file with no directory, is not traced', () => {
  const { device } = fakeDevice()
  const world = worldOf(40, 1, () => true)
  const trace = ensureSceneTrace(undefined, device, worldFileOf(), 3, world).sceneTrace!
  trace.syncPlacements([{ hlod: {} }, { hlod: {} }], world)
  assert.deepEqual(tableOf(trace).slice(4, 6), [WORLD, NO_INDEX])
  const bare = ensureSceneTrace(undefined, device, fileOf(), 3, world).sceneTrace!
  bare.syncPlacements([{ hlod: {} }], world)
  assert.equal(tableOf(bare)[4], NO_INDEX)
})

test('a file whose actors name a cell the cut does not pack is refused with its reason, the trace held given back', () => {
  const { device, destroyed } = fakeDevice()
  const file = worldFileOf()
  const held = ensureSceneTrace(
    undefined,
    device,
    file,
    3,
    worldOf(3, 1, () => false),
  ).sceneTrace!
  const refused = ensureSceneTrace(
    held,
    device,
    file,
    3,
    worldOf(2, 1, () => false),
  )
  assert.equal(refused.sceneTrace, undefined)
  assert.match(refused.why!, /3 cells, the cut packs 2/)
  destroyRetired(device)
  assert.ok(destroyed.includes(held.table))
  // The cut's cells are as many as the actors name, or more; a cut that packs no world has no instance to enter one.
  assert.ok(
    ensureSceneTrace(
      undefined,
      device,
      file,
      3,
      worldOf(3, 1, () => false),
    ).sceneTrace,
  )
  assert.ok(
    ensureSceneTrace(
      undefined,
      device,
      file,
      3,
      worldOf(40, 1, () => false),
    ).sceneTrace,
  )
  assert.ok(ensureSceneTrace(undefined, device, file, 3).sceneTrace)
  assert.ok(
    ensureSceneTrace(
      undefined,
      device,
      fileOf(),
      3,
      worldOf(1, 1, () => false),
    ).sceneTrace,
  )
})

test('the cells’ words are made again only when the cut’s draws, its cells, its roots or the stand-ins’ list moved; written only when they differ', () => {
  const gpu = fakeDevice()
  let asked = 0
  const world = worldOf(3, 2, (k, cell) => (asked++, k === 0 && cell === 1))
  const trace = ensureSceneTrace(undefined, gpu.device, worldFileOf(), 4, world).sceneTrace!
  const roots = [{ mesh: 3, primitive: 5 }, { hlod: {} }, {}, { hlod: {} }]
  const cellWrites = () => gpu.writes.filter((w) => w.buffer === trace.table && w.offset === 8 * 4)
  trace.syncPlacements(roots, world)
  assert.deepEqual([asked, cellWrites().length], [6, 1])
  trace.syncPlacements(roots, world)
  trace.syncPlacements(roots, world)
  assert.deepEqual([asked, cellWrites().length], [6, 1], 'nothing moved: not read, not written')
  // The cut's draw words moved, to the same answers: read again, not written again.
  ;(world.world as unknown as { drawRevision: number }).drawRevision++
  trace.syncPlacements(roots, world)
  assert.deepEqual([asked, cellWrites().length], [12, 1])
  // The stand-ins' list is another list: read again.
  trace.syncPlacements(roots, world, [...roots])
  assert.equal(asked, 18)
})
