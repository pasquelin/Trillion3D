// S31: the corner words of a page the cache gave no geometry page stay inside the page's own home.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { PAGE_POINTS_WGSL } from '../../visibility/shader/pageGeometryWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

type Fn = (...args: unknown[]) => unknown
/** Words before the page: its first word is never the pool's. */
const BASE = 3

test('an index page is read inside its own home', () => {
  const words = new Map<number, number>(),
    past: number[] = []
  let end = 0
  const indices = new Proxy([], {
    get: (_, key) => {
      const i = Number(key)
      if (i >= end) past.push(i)
      return words.get(i) ?? 0
    },
  })
  const run = shaderRun<Record<string, Fn>>(
    wgslModule(PAGE_POINTS_WGSL),
    ['pageTriangle', 'pageCorner'],
    { indices, positions: [] },
  )
  // A page the cache gave no geometry page: a word a corner, its home its own bytes.
  const corners = [0, 1, 2, 2, 1, 3]
  corners.forEach((corner, i) => words.set(BASE + i, corner))
  end = BASE + corners.length
  const row = { flags: 0, pageOffset: BASE, deformOutput: 0 }
  for (let tri = 0; tri < 2; tri++)
    assert.deepEqual(run.pageTriangle(row, {}, tri), corners.slice(tri * 3, tri * 3 + 3))
  for (let corner = 0; corner < 6; corner++)
    assert.equal(run.pageCorner(row, {}, corner), corners[corner])
  assert.deepEqual(past, [])
})
