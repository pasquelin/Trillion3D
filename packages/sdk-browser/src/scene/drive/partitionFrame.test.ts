import test from 'node:test'
import assert from 'node:assert/strict'
import type { Engine } from '../../session/engine/types.ts'
import { hostFramingCamera } from '../host/scan/graphObjects.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { createPartitionCells } from '../../geometry/partition/cells.ts'
import { placedMesh } from '../../geometry/partition/rows.ts'
import { paged } from '../../geometry/partition/paged.fixture.ts'
import { cellPriority, PRIORITY_VISIBLE } from '../../geometry/streaming/priority.ts'
import { createPartitionFrame } from './partitionFrame.ts'
import { budget, packsNoWorld, recording, streamer } from './partitionFrame.fixture.ts'

test('a frame hands the plan its camera’s eye, and reads what it asks', () => {
  const { cells, seen } = recording()
  const { port, asked } = streamer()
  const camera = hostFramingCamera(60, 16 / 9, 0.1, 500)
  camera.position.set(3, 4, 5)
  createPartitionFrame({
    partitions: [cells],
    streamer: port,
    camera,
    engine: packsNoWorld(),
    budget,
  })()
  assert.deepEqual(seen[0].eye, [3, 4, 5])
  assert.equal(seen[0].io.world, undefined, 'no cut packs the world DAG: no HLOD cell')
  assert.deepEqual(asked, [[['near.json'], PRIORITY_VISIBLE]])
})

test('a cut that packs the world DAG lends the plan its world cells', () => {
  const { cells, seen } = recording()
  const camera = hostFramingCamera(60, 16 / 9, 0.1, 500)
  const world = {},
    worldCells = () => world
  const frame = { partitions: [cells], streamer: streamer().port, camera, budget }
  createPartitionFrame({ ...frame, engine: { worldCells } as unknown as Engine })()
  assert.equal(seen[0].io.world, world)
})

/** What the frames from `camera` ask of one cell of one node, boxed by `bounds` under the root,
 *  once the page of the index that lists it is read, if it is. */
async function asks(
  url: string,
  bounds: number[],
  camera: Parameters<typeof createPartitionFrame>[0]['camera'],
) {
  const parents = [[null, bounds] as const]
  const cell = { url, sha256: '', bytes: 1, meshes: [[0, 1] as const], meshPages: [], parents }
  const { partition, files } = paged([cell], 1)
  const cells = createPartitionCells({
    partition,
    base: 'https://cache.test/key/',
    root: new Group(),
    parents: [],
    meshes: new Map([[0, placedMesh([{ meshes: 0, primitives: 0 }])]]),
  })
  const { port, asked } = streamer(files)
  const engine = packsNoWorld()
  const frame = createPartitionFrame({
    partitions: [cells],
    streamer: port,
    camera,
    engine,
    budget,
  })
  for (let step = 0; step < 4; step++) {
    frame()
    await frame.pending()
  }
  return [...new Map(asked.map((entry) => [JSON.stringify(entry), entry])).values()]
}

test('a pebble far below any error target is read while its grid cell is in range', async () => {
  // A small object within the main grid's loading range is read whatever it projects to: a cell's
  // actors load by its range alone, never by their size on screen. Its file is asked in the cells'
  // lane, by the turn the cell took to load (the first).
  const camera = hostFramingCamera(60, 16 / 9, 0.1, 300)
  assert.deepEqual(await asks('pebble.json', [200, 0, 0, 200.01, 0.01, 0.01], camera), [
    [['https://cache.test/key/pebble.json'], cellPriority(0)],
  ])
})

test('a view past the rows sized at open asks the owner to open the session again', () => {
  const renew = () => {}
  const { cells, seen } = recording()
  createPartitionFrame({
    partitions: [cells],
    streamer: streamer().port,
    camera: hostFramingCamera(60, 1, 0.1, 100),
    engine: packsNoWorld(),
    budget,
    renew,
  })!()
  assert.equal(seen[0].io.outgrown, renew)
})

test('a page the page worker pool refuses keeps its code and names its file', async () => {
  // A page of another version, decoded off the main thread: refused as the tables would be, by
  // `UNSUPPORTED_SCENE_TABLES`, and by its address.
  const parents = [[null, [0, 0, 0, 1, 1, 1]] as const]
  const cell = { url: 'a.json', sha256: '', bytes: 1, meshes: [[0, 1] as const], meshPages: [] }
  const { partition, files } = paged([{ ...cell, parents }], 1)
  const [name] = [...files.keys()]
  files.set(name, new TextEncoder().encode(JSON.stringify({ version: 3, cells: [] })))
  const cells = createPartitionCells({
    partition,
    base: 'https://cache.test/key/',
    root: new Group(),
    parents: [],
    meshes: new Map([[0, placedMesh([{ meshes: 0, primitives: 0 }])]]),
  })
  const camera = hostFramingCamera(60, 16 / 9, 0.1, 300)
  const engine = packsNoWorld()
  const frame = createPartitionFrame({
    partitions: [cells],
    streamer: streamer(files).port,
    camera,
    engine,
    budget,
  })!
  frame()
  await frame.pending()
  assert.throws(frame, (error: { code?: string; details?: { url?: string } }) => {
    assert.equal(error.code, 'UNSUPPORTED_SCENE_TABLES')
    assert.equal(error.details?.url, `https://cache.test/key/${name}`)
    return true
  })
})
