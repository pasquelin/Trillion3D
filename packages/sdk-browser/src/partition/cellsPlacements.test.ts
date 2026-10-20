// A model placed twice places its cells twice through one partition (`PartitionCells.placement`):
// each placement its own frame, view and cells, both on the same rows and catalogue. A file the
// two name is admitted once and kept while either names it (`cellIndex.test.ts` lets it go); a
// placement let go parks its own rows alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import { between, cellUrl, io, noBudget, opened, settled, world } from './cells.fixture.ts'

/** The rows of `links` placed now. */
const live = (links: ReturnType<typeof world>['links']) =>
  links.map((link) => link.placements!.live.reduce((sum, flag) => sum + flag, 0))

test('two placements of a partition share its rows and catalogue, counted per placement', async () => {
  const partition = world(),
    { cells: first, links, bytes } = partition
  const second = first.placement()
  // The second stands 1 000 km away: what the eye reaches of it is nothing until it is moved.
  const far = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1e9, 0, 0, 1)
  second.pose(() => far, 1)
  // Rows for every node of both, sized before the engines read them.
  await opened(first, bytes, false, [1e9, 0, 0])
  await opened(second, bytes, false, [-1e9, 0, 0])
  const { port, held, admitted, forgotten } = io(bytes)
  for (const name of ['near.json', 'far.json']) held.add(cellUrl(name))
  await settled(first, between, port, noBudget)
  const named = admitted.map((page) => page.url)
  assert.equal(first.stats().held, 2)
  assert.deepEqual(live(links), [3, 3], 'the first places its three nodes on each primitive')
  // The second, posed where the eye stands, places its own: the same files, admitted once.
  second.pose(() => Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1), 1)
  await settled(second, between, port, noBudget)
  assert.equal(second.stats().held, 2)
  assert.deepEqual(
    admitted.map((page) => page.url),
    named,
    'no file admitted again',
  )
  assert.deepEqual(live(links), [6, 6], 'its own rows beside the first’s')
  // The first moved past every cell's reach: its rows parked, the second's kept, no file
  // forgotten while the second names it.
  first.pose(() => far, 0)
  await settled(first, [0, 0, 0], port, noBudget)
  assert.deepEqual([first.stats().held, second.stats().held], [0, 2])
  assert.deepEqual(live(links), [3, 3])
  assert.deepEqual(forgotten, [], 'the second still names every file')
  // Moved away too, the second gives its rows back.
  second.pose(() => far, 1)
  await settled(second, [0, 0, 0], port, noBudget)
  assert.deepEqual(live(links), [0, 0])
  // A placement let go gives back its rows alone: the first, placed again, then let go.
  first.pose(() => Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1), 0)
  await settled(first, between, port, noBudget)
  assert.deepEqual(live(links), [3, 3])
  first.close(port)
  assert.deepEqual(live(links), [0, 0])
})
