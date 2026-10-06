// The WebGL2 per-instance draw table. Its placement tables are one object rewritten in place,
// so a reader built once — the pool's page parents, the held residency — follows every layout; and
// each root's instance state is carried across layouts from the packed base it was laid out at.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { createPageDraws } from './pageDraws.ts'
import { makeRec } from './pageRec.fixture.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts'

const root = (pages: PageRec[]): ClusterRoot<PageRec> => ({ world: new G.Matrix4(), pages })

test('the placement tables a reader took before a layout read the layout after it', () => {
  const pages = [makeRec(0, 1)],
    roots = [root(pages)]
  const draws = createPageDraws(roots),
    held = draws.placement
  roots.push(root(pages), root([makeRec(1, 1)]))
  draws.layOut(roots)
  assert.deepEqual(Array.from(held.baseOfRoot), [0, 1, 2], 'every root of the new layout')
  assert.deepEqual(Array.from(held.rootOfPacked), [0, 1, 2], 'every instance of it')
})

test('a layout that moves a root keeps its instances, a new root sharing the record starts dressed', () => {
  const a = makeRec(0, 1),
    b = makeRec(1, 1)
  const first = root([a]),
    draws = createPageDraws([first])
  const mine = draws.at(0)!
  mine.material = G.basicSurface()
  mine.attached = true
  const inserted = root([b]),
    sharing = root([a])
  draws.layOut([inserted, first, sharing])
  assert.equal(draws.at(1), mine, "the moved root's instance is the same state")
  assert.notEqual(draws.at(2), mine, 'the new placement has an instance of its own')
  assert.equal(draws.at(2)!.material, mine.material, 'wearing what the record wears')
  assert.equal(draws.at(2)!.attached, false, 'and not on the display graph yet')
})
