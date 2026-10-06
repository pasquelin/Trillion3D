import type { TestContext } from 'node:test'
import { worldPage } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { encodeWorldRoots } from '../../../sdk-core/src/manifest/worldRootsRecords.fixture.ts'
import { readWorldRoots } from '../../../sdk-core/src/manifest/worldRootsTable.ts'
import type { TableCell } from '../../../sdk-core/src/scene/core/tablePartition.ts'
import { Group } from '../../../sdk-core/src/world/object/object3d.ts'
import { openWorldRoots } from '../scene/worldRoots.ts'
import { served, sha } from '../scene/worldRoots.fixture.ts'
import { createPageStreamer } from '../streaming/pageStreamer.ts'
import { createPartitionCells } from './cells.ts'
import { paged } from './paged.fixture.ts'
import { placedMesh } from './rows.ts'
import type { HoldFailure } from './retries.ts'

/** The world roots of `count` cells: the top, bundle 0, pinned; then two bundles of one page per
 *  cell, side by side in the binary, which its object's roots need. */
function gridRoots(count: number) {
  const pages = Array.from({ length: 1 + 2 * count }, (_, at) => worldPage(at))
  const bin = new Uint8Array(pages.reduce((sum, page) => sum + page.byteLength, 0))
  let offset = 0
  const bundles = pages.map((page) => {
    bin.set(page, offset)
    offset += page.byteLength
    const bytes = page.byteLength
    return { offset: offset - bytes, bytes, sha256: sha(page), count: 1, dependencies: [0] }
  })
  const object = (cell: number) => ({
    ...{ node: 0, primitive: 0, roots: [0] },
    dependencies: [0, 1 + 2 * cell, 2 + 2 * cell],
  })
  const bytes = encodeWorldRoots({
    ...{ version: 3, budgetBytes: 4 << 20, pinned: 1, pinnedTopBytes: bundles[0].bytes },
    payload: { url: 'world-roots.bin', sha256: sha(bin), bytes: bin.byteLength },
    bundles,
    pages: bundles.map((_, bundle) => ({ bundle, offset: 0, level: 1, lodError: 1 })),
    cells: Array.from({ length: count }, (_, cell) => ({ objects: [object(cell)] })),
  })
  return { bytes, bin, table: readWorldRoots(bytes) }
}

/** A cell of `side` along x at its rank, 10 m wide, one node of mesh 0. */
const gridCell = (side: number, cell: number): TableCell => {
  const x = (cell % side) * 10,
    z = Math.floor(cell / side) * 10
  const box = [x, 0, z, x + 10, 5, z + 10]
  return {
    url: `c${cell}.json`,
    sha256: '',
    bytes: 1,
    meshes: [[0, 1]],
    meshPages: [],
    parents: [[null, box]],
  }
}

/**
 * A generated world of `side` × `side` cells 10 m apart, its roots served by `answer`
 * (`served`) and read through a page streamer of `transfers`, every cell's hold failure told
 * `said`: its partition's cells, its world roots, the streamer and the file each address reads.
 */
export async function gridWorld(
  t: TestContext,
  side: number,
  transfers: number,
  answer: NonNullable<Parameters<typeof served>[1]>['answer'],
  said?: HoldFailure,
) {
  const table = Array.from({ length: side * side }, (_, cell) => gridCell(side, cell))
  const { partition, files } = paged(table, 4)
  const { manifest } = served(t, { world: gridRoots(side * side), answer })
  const roots = (await openWorldRoots(manifest, 'http://world/'))!
  const streamer = createPageStreamer([], 'http://world/', { workerCount: transfers })
  roots.readThrough(streamer.ranged)
  const cells = createPartitionCells({
    ...{ partition, base: 'https://cache.test/key/', root: new Group(), parents: [] },
    meshes: new Map([[0, placedMesh([{ meshes: 0, primitives: 0 }])]]),
    world: roots,
    said,
  })
  const node = { parent: null, mesh: 0, matrix: null, translation: [1, 1, 1] }
  const pose = { rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
  const cellFile = new TextEncoder().encode(
    JSON.stringify({ version: 2, nodes: [{ ...node, ...pose }] }),
  )
  const bytes = (url: string) => files.get(url.split('/').at(-1)!) ?? cellFile
  return { cells, roots, streamer, bytes }
}

/** The cell whose run a Range header of `gridWorld`'s binary reads: its first bundle's. */
export const cellOfRange = (range: string, pageBytes: number) =>
  (Number(range.slice('bytes='.length).split('-')[0]) / pageBytes - 1) / 2
