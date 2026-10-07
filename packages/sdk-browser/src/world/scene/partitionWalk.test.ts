// A walk over a partitioned world, as a session runs it: the rows are sized at open for
// the first camera's view, the pages on its way and the cells it reaches read, and the frames then
// follow the camera through the index on an engine that grows no buffer.
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Engine } from '../../engine/types.ts'
import { hostFramingCamera } from '../../host/scene/graphObjects.ts'
import type { TableCell } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { createPartitionCells } from '../../partition/cells.ts'
import { placedMesh } from '../../partition/rows.ts'
import { paged } from '../../partition/paged.fixture.ts'
import type { createPageStreamer } from '../../streaming/pageStreamer.ts'
import { createPartitionFrame, primePartitions } from './partitionFrame.ts'

/** No arrival budget: what a test places never depends on the time the machine takes. */
const budget = { admits: () => true, spend() {} }

/** The rows the cook lists for `grid`'s cells, 8 m wide every 10 m, one mesh in two
 *  (`partition/pages/rows.rs`): a window one and a half times a rung's side meets that many cells
 *  a side, and one more; half of them, rounded up, place four nodes of the mesh. */
const CUBE = Math.hypot(8, 1, 8)
const ladder = {
  cube: CUBE,
  rows: (_: number, total: number, rung: number) =>
    Math.min(total, 4 * ceilDiv((ceilDiv(1.5 * CUBE * 2 ** (rung / 2), 10) + 1) ** 2, 2)),
}

/** A grid of `side`² cells ten metres wide, each placing four nodes of one of two meshes. */
function grid(side: number) {
  const cells: TableCell[] = []
  const bodies = new Map<string, Uint8Array>()
  for (let x = 0; x < side; x++)
    for (let z = 0; z < side; z++) {
      const url = `https://cache.test/key/cell-${x}-${z}.json`
      const mesh = (x + z) % 2
      const nodes = [0, 1, 2, 3].map((at) => ({
        parent: null,
        mesh,
        matrix: null,
        translation: [x * 10 + at * 2, 0, z * 10 + at * 2],
        rotation: null,
        scale: null,
      }))
      bodies.set(url, new TextEncoder().encode(JSON.stringify({ version: 2, nodes })))
      const bounds = [x * 10, 0, z * 10, x * 10 + 8, 1, z * 10 + 8]
      const parents: TableCell['parents'] = [[null, bounds]]
      cells.push({ url, sha256: '', bytes: 1, parents, meshes: [[mesh, 4]], meshPages: [] })
    }
  const { partition, files } = paged(cells, 8, undefined, ladder)
  for (const [name, bytes] of files) bodies.set(`https://cache.test/key/${name}`, bytes)
  const meshes = new Map([0, 1].map((rank) => [rank, placedMesh([{ meshes: rank }])]))
  const port = {
    readBytes: async (url: string) => bodies.get(url)!,
    getBytes: (url: string) => bodies.get(url),
    failed: () => false,
    request: async () => {},
    admit() {},
    forget() {},
  } as unknown as ReturnType<typeof createPageStreamer>
  const root = new Group()
  const partitioned = createPartitionCells({
    partition,
    base: 'https://cache.test/key/',
    root,
    parents: [],
    meshes,
  })
  return { partitioned, port }
}

test('on an engine that grows no buffer, a walk never leaves a cell waiting for rows', async () => {
  // It cannot grow rows in place, and the reach stays the one the rows were sized for at open:
  // rows for the view, a part of the world.
  const { partitioned, port } = grid(48)
  const camera = hostFramingCamera(60, 16 / 9, 0.1, 30)
  camera.position.set(5, 2, 5)
  await primePartitions([partitioned], camera, port, true)
  assert.ok(partitioned.stats().held > 0, 'the first frame draws what the camera reaches')
  assert.ok(partitioned.stats().rows < 48 * 48 * 4, `${partitioned.stats().rows} rows`)
  const frame = createPartitionFrame({
    partitions: [partitioned],
    streamer: port,
    camera,
    // Every engine is handed the rows; this one refuses to grow any in place.
    engine: {
      worldCut: () => undefined,
      updatePlacements() {},
      growPlacements() {},
      growsInPlace: () => false,
    } as unknown as Engine,
    budget,
  })!
  for (let step = 0; step <= 46; step++) {
    camera.position.set(5 + step * 5, 2, 5 + step * 5)
    camera.updateMatrixWorld()
    frame()
    await frame.pending()
    assert.equal(partitioned.stats().waiting, 0, `step ${step}`)
  }
  assert.ok(partitioned.stats().held > 1, 'the cells around the camera are placed')
})
