// The world DAG as the cut's records: a super-root is a geometry page in world space worn
// in the surface of the primitive it names, a placed object's cluster a record without a page, and
// a world no opaque mesh wears is not packed at all. On the cook's world fixture.
import test from 'node:test'
import assert from 'node:assert/strict'
import { worldRootsDag } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import type { Primitive } from '../../../sdk-core/src/index.ts'
import * as G from '../host/graph/graph.fixture.ts'
import { worldRootDag } from './worldSuperRoots.ts'
import { worldRootPages } from './worldPageServe.ts'
import { worldSelectionRoot, worldWearers } from './worldRecords.ts'
import { meshSurface } from '../page/surface.ts'
import { rootCoverOf } from '../webgpu/pages/prepare/rootCover.ts'
import { createWebgpuPageTracking } from '../webgpu/row/pageTracking.ts'

/** The cook's world DAG, every cluster wearing primitive 0. */
function dag() {
  const { clusters, groups } = worldRootsDag()
  return worldRootDag(
    { clusters, groups, payload: { url: 'world-roots.bin' }, pinned: 1 },
    worldRootPages,
  )!
}

test("a super-root is a geometry page worn in its primitive's surface", () => {
  const mesh = G.triangleMesh(G.standardSurface()),
    surface = meshSurface(mesh)
  const world = dag(),
    root = worldSelectionRoot(world, (p) => (p === 0 ? { mesh, surface } : undefined), 7)!
  assert.equal(root.pages.length, world.pages.length)
  root.pages.forEach((rec, rank) => {
    const page = world.pages[rank]
    assert.equal(rec.material, surface)
    assert.equal(rec.renderOrder, 7)
    if (world.origins[rank] >= 0) {
      assert.deepEqual([rec.url, rec.geometryPage], ['', undefined], 'its placement draws it')
      return
    }
    assert.equal(rec.url, page.url)
    assert.equal(rec.geometryPage?.url, page.url, 'the pool reads it at its world address')
    assert.equal(rec.geometryPage?.bytes, page.page?.bytes)
    assert.equal(rec.parentError, page.parentError)
  })
  assert.equal(root.origins, world.origins)
  assert.deepEqual(root.structure!.roots, [world.pages.length - 1], 'the world top')
  assert.deepEqual([...root.worldBox!], [0, -0.25, -0.25, 12, 0.25, 0.25])
  // Nothing an opaque mesh wears: no world to pack.
  assert.equal(
    worldSelectionRoot(world, () => undefined, 7),
    undefined,
  )
})

test('a world page is worn by the mesh of its primitive, never a blended one', () => {
  const opaque = G.triangleMesh(G.standardSurface()),
    clear = G.triangleMesh(G.standardSurface({ transparent: true, opacity: 0.5 })),
    blended = G.triangleMesh(G.standardSurface())
  const source = G.mesh()
  source.add(opaque, clear, blended)
  const associations = new Map([
    [opaque, { meshes: 0, primitives: 0 }],
    [clear, { meshes: 1, primitives: 0 }],
    [blended, { meshes: 2, primitives: 0 }],
  ])
  const primitives = [
    { mesh: 0, primitive: 0, pass: 'clustered' },
    { mesh: 1, primitive: 0, pass: 'clustered' },
    { mesh: 2, primitive: 0, pass: 'clustered-blend' },
    { mesh: 3, primitive: 0, pass: 'clustered' },
  ] as Primitive[]
  const wear = worldWearers(source, primitives, associations)
  assert.equal(wear(0)?.mesh, opaque)
  assert.equal(wear(1), undefined, 'its surface blends')
  assert.equal(wear(2), undefined, 'its primitive blends')
  assert.equal(wear(3), undefined, 'no mesh draws it')
})

test('a world root no mesh wears is no page: the cover and the floor take no slot for it', () => {
  const mesh = G.triangleMesh(G.standardSurface()),
    surface = meshSurface(mesh)
  const world = dag(),
    top = world.pages.length - 1
  ;(world.pages as { primitive: number | null }[])[top].primitive = 1
  const root = worldSelectionRoot(world, (p) => (p === 0 ? { mesh, surface } : undefined), 7)!
  assert.equal(root.pages[top].url, '', 'the pinned top no mesh wears')
  const cover = rootCoverOf([root], createWebgpuPageTracking(root.pages))
  assert.ok(cover.bootstrap.length > 0 || cover.floorPages > 0)
  assert.ok(!cover.bootstrapUrls.has(''), 'no page read at an empty address')
  assert.equal(cover.bootstrap.indexOf(root.pages[top]), -1)
})
