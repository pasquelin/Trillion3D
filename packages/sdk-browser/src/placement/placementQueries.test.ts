// #1235: one record serves every placement of its primitive. The compiler's tile follows the
// largest world scale that places a primitive (`mesh_scales`): read over every placement of its
// shared records, not the first one alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { largestScale } from './placementQueries.ts'
import { createPageDraws } from '../backend/autonomous/pageDraws.ts'
import { makeRec } from '../backend/autonomous/pageRec.fixture.ts'
import type { ClusterRoot, PageRec } from '../page/selection/types.ts'

test('the largest scale is read over every placement of a shared record', () => {
  const rec = makeRec(0, 1),
    pages = [rec]
  const roots: ClusterRoot<PageRec>[] = [1, 3, 2].map((scale) => ({
    world: new G.Matrix4().makeScale(scale, scale, scale),
    pages,
  }))
  assert.equal(largestScale([rec], roots, createPageDraws(roots)), 3)
})
