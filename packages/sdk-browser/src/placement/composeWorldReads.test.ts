// A root a parent composes reads the world the GPU composes, whoever reads it: a CPU reader gets
// the parent's world times the local, and a parent that turns its winding has its rows written again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { composeWebgpuPlacements } from './gpuCompose.ts'
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { session, turn } from './composeSession.fixture.ts'

test('a root a parent composes reads the composed world; a parent that turns its winding has its rows written again, at the winding the GPU composes', () => {
  const { rt, rows } = session()
  const written: number[] = []
  Object.assign(rt.layout, { rows: { pageTableFloats: undefined, rowOf: () => -1 } })
  const roots = rt.layout.selectionRoots as unknown as { pages: unknown[]; windingEpoch?: number }[]
  for (const root of roots) root.pages = []
  ;(rt.run as unknown as { movedWorlds: unknown }).movedWorlds = {
    listed: { add: (rank: number) => written.push(rank) },
  }
  const parent = {},
    links = [0, 1].map((index) => ({ rows, index, local: turn(0.25) }))
  composeWebgpuPlacements(rt, parent, turn(0), links, true)
  const world = (rank: number) =>
    Array.from(
      (rt.layout.selectionRoots[rank] as never as { world: { elements: ArrayLike<number> } }).world
        .elements,
    )
  const expected = new Float64Array(16)
  multiplyMatrix4(expected, Float64Array.from(turn(0.7)), Float64Array.from(turn(0.25)))
  assert.equal(composeWebgpuPlacements(rt, parent, turn(0.7), [], false), true, 'a turn')
  assert.deepEqual(world(1), [...expected], 'read, a root is its parent’s world times its local')
  assert.deepEqual(written, [], 'no row written for a turn')
  const mirrored = turn(0.5)
  mirrored[0] = -mirrored[0]
  mirrored[1] = -mirrored[1]
  mirrored[2] = -mirrored[2]
  assert.equal(composeWebgpuPlacements(rt, parent, mirrored, [], false), true, 'a mirror too')
  assert.deepEqual(written.sort(), [0, 1], 'its rows are written again: their bins follow')
  composeWebgpuPlacements(rt, parent, turn(0.9), [], false)
  assert.deepEqual(written.sort(), [0, 0, 1, 1], 'and again when it turns back')
})
