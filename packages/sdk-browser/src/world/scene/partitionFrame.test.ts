import test from 'node:test'
import assert from 'node:assert/strict'
import type { RenderBackend } from '../../backend/types.ts'
import { hostFramingCamera } from '../../host/scene/graphObjects.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { createPartitionCells, type PartitionCells } from '../../partition/cells.ts'
import { cellReach } from '../../partition/plan.ts'
import { lensSlope } from '../../partition/superRoots.ts'
import { createSelectionUniforms } from '../../gpu/core/selection.ts'
import { createCellPages, withHoldings } from '../../partition/cellPages.ts'
import { placedMesh } from '../../partition/rows.ts'
import { paged } from '../../partition/paged.fixture.ts'
import { PRIORITY_PREFETCH, PRIORITY_VISIBLE } from '../../streaming/priority.ts'
import type { createPageStreamer } from '../../streaming/pageStreamer.ts'
import { createPartitionFrame } from './partitionFrame.ts'

type Io = Parameters<PartitionCells['frame']>[2]
/** No arrival budget: what a test places never depends on the time the machine takes. */
const budget = { admits: () => true, spend() {} }

/** Cells that record what a frame hands them, and ask for one cell visible and one ahead. */
function recording() {
  const seen: { eye: number[]; reach: number; io: Io }[] = []
  const cells = withHoldings(
    { meshes: new Map(), manifest: createCellPages(undefined, () => []) },
    {
      frame(eye: number[], reach: number, io: Io) {
        seen.push({ eye: [...eye], reach, io })
        io.request(['near.json'], false)
        io.request(['ahead.json'], true)
      },
      decodes: () => [],
      reads: () => [],
      due: () => Infinity,
    } as unknown as PartitionCells,
  )
  return { cells, seen }
}

/** A streamer that holds `files` by name, and records what it is asked. */
function streamer(files: ReadonlyMap<string, Uint8Array> = new Map()) {
  const asked: [readonly string[], number][] = []
  const port = {
    request: async (urls: readonly string[], options: { priority: number }) =>
      void asked.push([urls, options.priority]),
    getBytes: (url: string) => files.get(url.split('/').at(-1)!),
    loading: () => false,
    admit() {},
    forget() {},
  } as unknown as ReturnType<typeof createPageStreamer>
  return { port, asked }
}

test('no partition, no step before the frame', () => {
  const frame = createPartitionFrame({
    partitions: [],
    streamer: streamer().port,
    camera: hostFramingCamera(60, 1, 0.1, 100),
    active: () => ({}) as RenderBackend,
    budget,
  })
  assert.equal(frame, null)
})

test('a frame reads the cells within the far plane of its camera, visible first then ahead', () => {
  const { cells, seen } = recording()
  const { port, asked } = streamer()
  const camera = hostFramingCamera(60, 16 / 9, 0.1, 500)
  camera.position.set(3, 4, 5)
  createPartitionFrame({
    partitions: [cells],
    streamer: port,
    camera,
    active: () => ({}) as RenderBackend,
    budget,
  })!()
  assert.deepEqual(seen[0].eye, [3, 4, 5])
  assert.equal(seen[0].reach, cellReach(camera))
  assert.equal(seen[0].io.lens, undefined, 'no cut packs the world DAG: no far cell')
  assert.deepEqual(asked, [
    [['near.json'], PRIORITY_VISIBLE],
    [['ahead.json'], PRIORITY_PREFETCH],
  ])
})

test('a cut that packs the world DAG lends the plan its lens, on the frustum diagonal', () => {
  const { cells, seen } = recording()
  const camera = hostFramingCamera(60, 16 / 9, 0.1, 500)
  const uniforms = createSelectionUniforms(),
    worldCut = () => uniforms
  const frame = { partitions: [cells], streamer: streamer().port, camera, budget }
  createPartitionFrame({ ...frame, active: () => ({ worldCut }) as unknown as RenderBackend })!()
  assert.deepEqual(seen[0].io.lens, { ...uniforms, slope: lensSlope(camera) })
  const diagonal = Math.tan(Math.PI / 6) * Math.hypot(1, 16 / 9)
  assert.ok(Math.abs(lensSlope(camera) - diagonal) < 1e-12, 'the half diagonal of the field')
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
  const active = () => ({}) as RenderBackend
  const frame = createPartitionFrame({
    partitions: [cells],
    streamer: port,
    camera,
    active,
    budget,
  })!
  for (let step = 0; step < 4; step++) {
    frame()
    await frame.pending()
  }
  return [...new Map(asked.map((entry) => [JSON.stringify(entry), entry])).values()]
}

test('a pebble far below any error target is read while the far plane lets it be drawn', async () => {
  // Nothing coarser stands for an unread cell: a small object within the far plane is
  // read whatever it projects to, or it would be missing from the image for good.
  const camera = hostFramingCamera(60, 16 / 9, 0.1, 300)
  assert.deepEqual(await asks('pebble.json', [200, 0, 0, 200.01, 0.01, 0.01], camera), [
    [['https://cache.test/key/pebble.json'], PRIORITY_VISIBLE],
  ])
})

test('a camera zoomed out, or scaled up, reads the cells its wider frustum sees', async () => {
  // At zoom 0.5 the frustum is twice as wide, scaled twice it draws twice as far: a pebble 560 m
  // aside, 290 m ahead, is within either's reach, past the read-ahead of the camera at zoom 1.
  const bounds = [560, 0, -290, 560.01, 0.01, -289.99]
  const seen = [['https://cache.test/key/aside.json'], PRIORITY_VISIBLE]
  const camera = hostFramingCamera(60, 16 / 9, 0.1, 300)
  assert.deepEqual(await asks('aside.json', bounds, camera), [])
  camera.zoom = 0.5
  assert.deepEqual(await asks('aside.json', bounds, camera), [seen])
  camera.zoom = 1
  ;(camera as unknown as Group).scale.set(2, 2, 2)
  assert.deepEqual(await asks('aside.json', bounds, camera), [seen])
})

test('a view past the rows sized at open asks the owner to open the session again', () => {
  const renew = () => {}
  const { cells, seen } = recording()
  createPartitionFrame({
    partitions: [cells],
    streamer: streamer().port,
    camera: hostFramingCamera(60, 1, 0.1, 100),
    active: () => ({}) as RenderBackend,
    budget,
    renew,
  })!()
  assert.equal(seen[0].io.outgrown, renew)
})

test('a page the decode pool refuses keeps its code and names its file', async () => {
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
  const active = () => ({}) as RenderBackend
  const frame = createPartitionFrame({
    partitions: [cells],
    streamer: streamer(files).port,
    camera,
    active,
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
