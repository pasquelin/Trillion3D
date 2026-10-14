// A blended root a parent composes on the GPU has the corners of its transparent entries derived
// again whenever its composed world moves — linked, or its parent moved —, through the one path a
// root's moved world names its entries by (`poseEntries`), as a root moved on its own does.
import test from 'node:test'
import assert from 'node:assert/strict'
import { composeWebgpuPlacements } from './gpuCompose.ts'
import { session, turn } from './composeSession.fixture.ts'
import { createChangedRuns } from '../webgpu/residency/ranges.ts'

test("a composed blended root's entries are derived again at its link and at each parent move", () => {
  const { rt, rows } = session()
  // Root 1 is blended, its two pages packed from rank 10, entries 3 and 4 of the table.
  Object.assign(rt.layout.selectionRoots[1], {
    pages: [{ transparent: true }, { transparent: true }],
    packedBase: 10,
  })
  const posed = createChangedRuns()
  Object.assign(rt.blendState, {
    table: { entryOf: (page: number) => (page === 10 ? 3 : page === 11 ? 4 : -1) },
    occlusionPosed: posed,
  })
  const parent = {},
    links = [0, 1].map((index) => ({ rows, index, local: turn(0.4) }))
  composeWebgpuPlacements(rt, parent, turn(0), links, true)
  assert.deepEqual([...posed.take()], [3, 4], 'linked: its entries follow the composed world')
  composeWebgpuPlacements(rt, parent, turn(0), [], false)
  assert.deepEqual([...posed.take()], [], 'a still parent moves no entry')
  composeWebgpuPlacements(rt, parent, turn(0.2), [], false)
  assert.deepEqual([...posed.take()], [3, 4], 'the parent turned: its entries again')
})
