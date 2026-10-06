// The near/far choice of a cell is the cut's (#1332): its super-roots' bound read from the world
// DAG the cook publishes (`worldRootsDag`), and their projected error never below what the cut's
// own certified bound gives any replacing sphere's point the frustum shows.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cellSuperRootError, cellSuperRoots } from './superRoots.ts'
import { worldRootsDag } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { projectedErrorAt } from '../page/selection/projection.ts'

const lens = { pixelScale: [800, 600] as [number, number], pixelError: 1, near: 0.1, slope: 1 }
/** Four object roots per cell, as the fixture's origins run. */
const cellOf = (origin: number) => Math.floor(origin / 4)
/** Five numbers per cell: its error, then its sphere. */
const FLOATS = 5

test("a cell's super-roots are bounded by the spheres replacing its object roots", () => {
  const { clusters } = worldRootsDag()
  const bounds = cellSuperRoots(clusters, cellOf, 3)
  for (let cell = 0; cell < 3; cell++)
    assert.deepEqual(
      [...bounds.subarray(cell * FLOATS, (cell + 1) * FLOATS)],
      [0.05, cell * 4 + 2, 0, 0, 2],
    )
  // An object root no super-root replaces keeps its cell near; a cell absent from the DAG too.
  const kept = clusters.map((c) => (c.cluster === 5 ? { ...c, parentError: null } : c))
  const near = cellSuperRoots(kept, cellOf, 4)
  assert.deepEqual([near[FLOATS], near[3 * FLOATS]], [Infinity, Infinity])
  assert.equal(near[0], 0.05, 'the other cells keep their bound')
})

test("the plan's error is never below the cut's for a point the frustum shows", () => {
  const bounds = cellSuperRoots(worldRootsDag().clusters, cellOf, 3)
  const focal = 800
  let last = Infinity
  for (const away of [3, 5, 10, 40, 160]) {
    const eye = [2, 0, away]
    const error = cellSuperRootError(bounds, 0, eye, lens)
    assert.ok(error <= last, 'it falls with distance')
    last = error
    // Each point of the replacing sphere the frustum shows, on axis and off it, as the cut
    // projects it.
    for (const [x, y, z] of [
      [2, 0, 2],
      [0, 0, 0],
      [4, 0, 0],
      [2, 2, 0],
    ]) {
      const depth = away - z,
        lateral = Math.hypot(x - 2, y)
      if (lateral > depth * lens.slope) continue
      const cut = projectedErrorAt(0.05, lateral, depth, 0, 1, focal, lens.near)
      assert.ok(error >= cut * (1 - 1e-12), `${error} < ${cut} at ${away}`)
    }
  }
  assert.equal(cellSuperRootError(bounds, 0, [2, 0, 1], lens), Infinity, 'inside: always near')
})
