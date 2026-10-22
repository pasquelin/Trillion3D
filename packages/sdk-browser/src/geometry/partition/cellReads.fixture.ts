import type { TestContext } from 'node:test'
import { flatChain, packBundles, worldPage } from '../hlod/worldRootsPages.fixture.ts'
import {
  encodeWorldRoots,
  noRows,
} from '../../../../sdk-core/src/manifest/worldRootsRecords.fixture.ts'
import { readWorldRoots } from '../../../../sdk-core/src/manifest/worldRootsTable.ts'
import { WORLD_ROOTS_VERSION } from '../../../../sdk-core/src/contracts/writtenFormats.ts'
import type { TableCell } from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import { Group } from '../../../../sdk-core/src/world/object/object3d.ts'
import { opened, served, sha } from '../hlod/worldRoots.fixture.ts'
import { createPartitionCells } from './cells.ts'
import { paged } from './paged.fixture.ts'
import { placedMesh } from './rows.ts'
import type { PageStreamerOptions } from '../streaming/types.ts'
import { io } from './cells.fixture.ts'

/** The world HLOD of `count` HLOD 0 cells: two bundles of one page per cell, side by side in the
 *  binary, which hold its roots. */
function gridRoots(count: number) {
  const pages = Array.from({ length: 2 * count }, (_, at) => worldPage(at).bytes)
  const { bin, bundles } = packBundles(
    pages.map((page) => [page]),
    sha,
  )
  const bytes = encodeWorldRoots({
    version: WORLD_ROOTS_VERSION,
    payload: { url: 'world-roots.bin', sha256: sha(bin), bytes: bin.byteLength },
    bundles,
    pages: bundles.map(({ bytes }, bundle) => ({
      bundle,
      offset: 0,
      bytes,
      level: 1,
      lodError: 1,
    })),
    hlod: Array.from({ length: count }, (_, cell) => [2 * cell, 2 * cell + 1]),
    chain: flatChain(count),
    rows: noRows(count),
  })
  return { bytes, bin, table: readWorldRoots(bytes) }
}

/** A cell of `side` along x at its rank, 10 m wide, one node of mesh 0, its own HLOD 0 cell. */
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
    grid: [0, 0, 0],
    bounds: box,
    hlod: [cell, box, 1, 0],
  }
}

/**
 * A generated world of `side` × `side` cells 10 m apart, its roots served by `answer`
 * (`served`) and opened through a page streamer of `transfers` and `maxTransferBytes`
 * (`opened`), a read that keeps failing told `stalled`: its partition's cells, its world roots,
 * the streamer, the file each address reads, and an io of its frames — its cell files `held` once
 * read, `asked` the urls it was asked.
 */
export async function gridWorld(
  t: TestContext,
  side: number,
  transfers: number,
  answer: NonNullable<Parameters<typeof served>[1]>['answer'],
  stalled?: PageStreamerOptions['onStalled'],
  maxTransferBytes?: number,
) {
  const table = Array.from({ length: side * side }, (_, cell) => gridCell(side, cell))
  const { partition, files } = paged(table, 4)
  const { manifest } = served(t, { world: gridRoots(side * side), answer })
  // A failed read is tried again without end: the waits between the tries are what its tests read.
  const opening = { transfers, onStalled: stalled, maxTransferBytes, numRetries: () => -1 }
  const { roots, queue: streamer } = await opened(t, manifest, opening)
  const cells = createPartitionCells({
    ...{ partition, base: 'https://cache.test/key/', root: new Group(), parents: [] },
    meshes: new Map([[0, placedMesh([{ meshes: 0, primitives: 0 }])]]),
    world: roots,
  })
  const node = { parent: null, mesh: 0, matrix: null, translation: [1, 1, 1] }
  const pose = { rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
  const cellFile = new TextEncoder().encode(
    JSON.stringify({ version: 3, nodes: [{ ...node, ...pose }] }),
  )
  const bytes = (url: string) => files.get(url.split('/').at(-1)!) ?? cellFile
  const { port, held, asked } = io(bytes)
  return { cells, roots, streamer, bytes, port, held, asked }
}

/** The cell whose run of `gridWorld`'s binary starts at byte `from`: its first bundle's. */
export const cellAt = (from: number, pageBytes: number) => from / pageBytes / 2
