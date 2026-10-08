// What the world bundles count of each cell follows the cells the plan reaches: a camera that
// travels across thousands of cells keeps the counts of those near it, never of every cell it
// passed. On a generated table of many cells.
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
  const bundles = createWorldBundles(readWorldRoots(encodeWorldRoots(spec)), 'world-roots.bin', [
    [],
  ])
  bundles.cover.bind(() => 1 << 20, new AbortController().signal)
  // Each frame reaches ten cells ahead of the camera, which moves a cell a frame.
  for (let frame = 0; frame < 1990; frame++) {
    const reached = new Set(Array.from({ length: 10 }, (_, k) => frame + k))
    bundles.cover.keep(reached)
    for (const cell of reached) bundles.cover.admits(cell)
  }
  assert.ok(bundles.countedCells <= 2 * 10, `${bundles.countedCells} cells counted`)
})
