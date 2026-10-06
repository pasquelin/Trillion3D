// A WebGL2 instance buffer grown in place adds roots, never records. One record serves every
// placement of its primitive, so a grown row reads its primitive's record — already catalogued and
// indexed by URL — and its new instance wears the geometry and surface the record's first wears.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { autonomousPlacements } from './autonomousPlacements.ts'
import { createPlacementRows, placementWorld } from './rows.ts'
import { createPageDraws } from '../backend/autonomous/pageDraws.ts'
import { makeRec } from '../backend/autonomous/pageRec.fixture.ts'
import type { ClusterRoot, PageRec } from '../page/selection/types.ts'

type Env = Parameters<typeof autonomousPlacements>[0]

test('a grown WebGL2 row reads the shared record: no record pushed again, its instance dressed', () => {
  const from = createPlacementRows(1),
    to = createPlacementRows(3)
  const rec = makeRec(0, 1),
    root: ClusterRoot<PageRec> = {
      world: placementWorld(from, 0),
      pages: [rec],
      placement: { rows: from, index: 0 },
    }
  const roots = [root],
    allPages = [rec],
    byUrl = new Map([[rec.url, [rec]]])
  const draws = createPageDraws(roots),
    geometry = new G.Geometry(),
    surface = G.basicSurface()
  draws.drawing(rec).geometry = geometry as never
  draws.drawing(rec).material = surface
  const placements = autonomousPlacements({
    ...{ roots, allPages, bootstrap: [], byUrl, draws, blendCopies: [] },
    scene: { add() {} } as unknown as Env['scene'],
    gate: { sceneChanged() {} } as unknown as Env['gate'],
    geometryStore: { rowsWritten() {} } as unknown as Env['geometryStore'],
    coverChanged() {},
  } as unknown as Env)
  placements.growPlacements(from, to)
  assert.equal(roots.length, 3, 'one root per row')
  assert.deepEqual(allPages, [rec], 'the catalogue keeps one record per primitive page')
  assert.deepEqual(byUrl.get(rec.url), [rec], 'and the URL index one entry')
  assert.equal(draws.instances(rec), 3, 'one instance per row')
  for (let packed = 0; packed < 3; packed++) {
    assert.equal(draws.at(packed)!.geometry, geometry, `instance ${packed} draws the page`)
    assert.equal(draws.at(packed)!.material, surface, `instance ${packed} wears its surface`)
  }
})
