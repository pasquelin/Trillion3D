// The world HLOD as the cut's records: every cluster is a geometry page in world space worn in its
// actor's flattened surface, a cluster whose actor has none a record without a page, and a world
// with no surface is not packed at all. On the cook's world fixture.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldBinary, worldRootsDag } from './worldRootsPages.fixture.ts'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { worldRootDag } from './worldHlod.ts'
import { worldRootPages } from './worldRootPages.ts'
import { worldSelectionRoots } from './worldRecords.ts'
import { sourceSurface } from '../pages/surface.ts'
import { drawSourceOf } from '../selection/drawSource.ts'
import { rootCoverOf } from '../../frame/prepare/rootCover.ts'
import { pageAddress } from '../rows/page/pageSlots.ts'
import { createWebgpuPageTracking } from '../rows/page/pageTracking.ts'
import { rootWorldBox } from '../selection/rootWorld.ts'

/** The cook's world DAG, every cluster worn by actor 0. */
function dag() {
  const { clusters, groups, culling } = worldRootsDag()
  return worldRootDag({ clusters, groups, culling, ...worldBinary() }, worldRootPages)!
}

test("a world cluster is a geometry page worn in its actor's flattened surface", () => {
  const surface = sourceSurface(drawSourceOf(G.triangleMesh(G.standardSurface())))
  const world = dag(),
    [root] = worldSelectionRoots(world, [surface], 7)
  assert.equal(root.pages.length, world.pages.length)
  root.pages.forEach((rec, rank) => {
    const page = world.pages[rank]
    assert.equal(rec.material, surface)
    assert.equal(rec.renderOrder, 7)
    assert.equal(rec.url, page.url)
    assert.equal(rec.geometryPage?.url, page.url, 'the pool reads it at its world address')
    assert.equal(rec.geometryPage?.bytes, page.page?.bytes)
    assert.equal(rec.parentError, page.parentError)
    assert.equal(rec.hlodLayer, 1, 'HLODLayer_Merged')
    assert.equal(rec.drawSource, undefined, 'no mesh of the scene draws an actor')
  })
  assert.equal(root.hlod, world.hlod, "each rank's HLOD 0 cell")
  assert.equal(root.structure!.roots.length, 3, 'one HLOD 1 root per HLOD 0 cell')
  assert.deepEqual([...rootWorldBox(root)!], [0, -0.25, -0.25, 3, 0.25, 0.25])
  // No actor's surface: no world to pack.
  assert.deepEqual(worldSelectionRoots(world, [], 7), [])
})

test('a world root whose actor has no surface is no page: the cover and the floor take no slot for it', () => {
  const surface = sourceSurface(drawSourceOf(G.triangleMesh(G.standardSurface())))
  const world = dag(),
    top = world.structure!.roots[0]
  ;(world.pages as { material: number }[])[top].material = 1
  const [root] = worldSelectionRoots(world, [surface], 7)
  assert.equal(root.pages[top].url, '', 'the root no surface wears')
  const cover = rootCoverOf([root], createWebgpuPageTracking(root.pages))
  const holder = (world.pages[top] as { holder?: number }).holder!
  assert.ok(!root.pagesOf(holder).includes(root.pages[top]), 'its cell holds it not')
  assert.ok(
    !cover.bootstrap.some((page) => pageAddress(page) === ''),
    'no page read at an empty address',
  )
  assert.equal(cover.bootstrap.indexOf(root.pages[top]), -1)
})
