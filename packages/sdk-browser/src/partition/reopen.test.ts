// A session opened again on the scene it kept (`../world/session/pageSources.ts`, `sceneThrough`)
// reads its pages through a new streamer, whose catalogue holds what the cells name at that open:
// the pages the first session opened stay opened, so the new prime walks none of them and reads
// the cells they list it had not placed yet at once. Every file it reads must be one the catalogue
// took.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readCellPage } from '../../../sdk-core/src/scene/core/tablePartition.ts'
import type { PartitionCells } from './cells.ts'
import {
  decodeHere,
  world,
  everywhere,
  io,
  noBudget,
  settled,
  sizedWhole,
} from './cells.fixture.ts'

/** Primes `cells` for an eye at the origin through a catalogue that starts with what the cells name
 *  now, and takes what the prime opens; a read of a file it does not hold is refused, as the
 *  streamer's queue refuses it. */
function primeThroughCatalogue(cells: PartitionCells, bytes: (url: string) => Uint8Array) {
  const catalogue = new Set(cells.pages.map((page) => page.url))
  return cells.prime(
    [0, 0, 0],
    everywhere,
    {
      read: async (url) => {
        if (!catalogue.has(url)) throw new Error(`Unknown page ${url}`)
        return bytes(url)
      },
      decode: decodeHere,
      decodePage: async (read, url) => readCellPage(read, url),
      admit: (pages) => pages.forEach((page) => catalogue.add(page.url)),
    },
    true,
  )
}

test('a session opened again on the kept cells reads only the files its new catalogue holds', async () => {
  const { cells, bytes } = await sizedWhole(world())
  // The first session opens the pages on its way; its cells are still in flight when it closes.
  await settled(cells, [0, 0, 0], everywhere, io(bytes).port, noBudget)
  assert.deepEqual(
    [cells.stats().pages, cells.stats().held],
    [3, 0],
    'pages opened, no cell placed',
  )
  // The next session's streamer is new: its catalogue holds only what the cells name now.
  assert.ok(
    (await primeThroughCatalogue(cells, bytes)) > 0,
    'the cells within reach are read again',
  )
  assert.equal(cells.stats().held, 2, 'both cells placed')
})
