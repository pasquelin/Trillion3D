// #966 (from #558): a cooked open-world cell's node casts as its host mesh says. Its rows carry
// the flag (`PlacementRows.shadowless`), which leaves the row out of every light cut
// (`placement/update.test.ts`); a `castShadow` changed after the cell was placed rewrites them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { object } from '../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../sdk-core/src/world/geometry/index.ts'
import { io, noBudget, opened, world } from './cells.fixture.ts'

test("a cell's rows cast as their host mesh says, and follow its castShadow once changed", async () => {
  const [plain, ink] = [0, 1].map(() => object.mesh(geometry.box(1, 1, 1)))
  ink.castShadow = false
  const { cells, links, bytes } = world(0, null, [plain, ink])
  await opened(cells, bytes, 1e5, false)
  const shadowless = () => links.map((link) => [...link.placements!.shadowless.subarray(0, 3)])
  assert.deepEqual(shadowless(), [
    [0, 0, 0],
    [1, 1, 1],
  ])
  const { port, updates } = io(bytes)
  cells.frame([0, 0, 0], 1e5, port, noBudget)
  assert.equal(updates.length, 0, 'a still flag writes no row')
  ;[plain.castShadow, ink.castShadow] = [false, true]
  cells.frame([0, 0, 0], 1e5, port, noBudget)
  assert.deepEqual(shadowless(), [
    [1, 1, 1],
    [0, 0, 0],
  ])
  assert.deepEqual(
    updates.map(([rows, from, to]) => [links.findIndex((l) => l.placements === rows), from, to]),
    [
      [0, 0, 2],
      [1, 0, 2],
    ],
    'both primitives rewrite their rows, sent before the frame',
  )
})
