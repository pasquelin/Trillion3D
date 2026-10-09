// What the world bundles count of each cell follows the cells the plan reaches: a camera that
// travels across thousands of cells keeps the counts of those near it, never of every cell it
// passed — a cell it comes back to has its list read again from the table. On a generated table
// of many cells.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { encodeWorldRoots } from '../../../sdk-core/src/manifest/worldRootsRecords.fixture.ts'
import { readWorldRoots } from '../../../sdk-core/src/manifest/worldRootsTable.ts'
import { createWorldBundles } from './worldBundles.ts'

test('a camera travelling across the cells keeps the counts of the cells it reaches alone', () => {
  const { spec } = worldRootsFixture()
  const object = (dependencies: number[]) => ({ node: 0, primitive: 0, roots: [0], dependencies })
  spec.cells = Array.from({ length: 2000 }, (_, cell) => ({
    objects: [object([0, 1 + (cell % 3)])],
  }))
  const table = readWorldRoots(encodeWorldRoots(spec))
  // Each read of a cell's list from the table, by cell.
  const reads = new Map<number, number>(),
    first = table.cells.first
  table.cells.first = (cell) => (reads.set(cell, (reads.get(cell) ?? 0) + 1), first(cell))
  const bundles = createWorldBundles(table, 'world-roots.bin', [[]])
  bundles.cover.bind(() => 1 << 20, new AbortController().signal)
  // Each frame reaches ten cells ahead of the camera, which moves a cell a frame.
  const reach = (frame: number) => {
    const reached = new Set(Array.from({ length: 10 }, (_, k) => frame + k))
    bundles.cover.keep(reached)
    for (const cell of reached) bundles.cover.admits(cell)
  }
  for (let frame = 0; frame < 1990; frame++) reach(frame)
  assert.ok(
    [...reads.values()].every((count) => count === 1),
    'each list read once on the way',
  )
  // Back to the start: the lists of the cells passed were let go, and are read again.
  reach(0)
  assert.equal(reads.get(0), 2, 'the first cell read anew')
})
