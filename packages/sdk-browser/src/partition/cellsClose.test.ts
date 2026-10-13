// A partition let go — the model it hung from left the scene — gives every row back, parked, and
// unpins what its plan asked; followed again, its cells place again (`PartitionCells.close`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { cellUrl, everywhere, io, noBudget, settled, sizedWhole, world } from './cells.fixture.ts'

test('a partition let go gives every row back, parked, and unpins what its plan asked', async () => {
  const { cells, links, bytes } = await sizedWhole(world())
  const { port, held, updates, pinned } = io(bytes)
  ;['near.json', 'far.json'].forEach((name) => held.add(cellUrl(name)))
  await settled(cells, [0, 0, 0], everywhere, port, noBudget)
  assert.equal(cells.stats().held, 2)
  updates.length = 0
  cells.close(port)
  assert.equal(cells.stats().held, 0, 'no cell placed')
  for (const link of links)
    assert.equal(
      link.placements!.live.reduce((sum, flag) => sum + flag, 0),
      0,
      'every row parked',
    )
  assert.ok(updates.length, 'the parked rows are sent')
  assert.deepEqual([...pinned.values()], new Array(pinned.size).fill(0), 'none pinned')
  // Followed again, the cells place again: the rows were given back, not lost.
  await settled(cells, [0, 0, 0], everywhere, port, noBudget)
  assert.equal(cells.stats().held, 2)
})
