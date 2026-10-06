import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { pagesBounds } from './pagesBounds.ts'
import { emptyWorldBox } from '../../host/world/bounds.ts'
import { createPlacementRows } from '../../placement/rows.ts'
import { asHostLibrary } from '../../host/resources.ts'
import { indexManifestPages, indexManifestBundles } from '../../scene/manifestPageIndex.ts'
import {
  referenceIndexManifestPages,
  referenceIndexManifestBundles,
} from '../../../../../bench/oracles/browser/manifest-index.ts'
import type { ClusterManifest, Page, Primitive } from '../../../../sdk-core/src/index.ts'

// Three manifest reads go from a `find` or `flatMap` per mesh/page to a single indexed walk.
// `indexManifestPages`/`indexManifestBundles` (../../scene/manifestPageIndex.ts) and `pagesBounds`
// (./pagesBounds.ts, via `primitiveFinder`) must return exactly what the four `flatMap`s and the
// `find` return. The oracles are copied as-is in `bench/oracles/browser/bounds-and-index.ts`.
function pageDe(id: number, url: string, geometryUrl?: string): Page {
  const page = { id, url, sha256: url, bytes: 8, count: 3, min: [0, 0, 0], max: [1, 1, 1] } as Page
  if (geometryUrl)
    page.geometry = { url: geometryUrl, sha256: geometryUrl, bytes: 8 } as Page['geometry']
  return page
}
function manifestePartage(): ClusterManifest {
  // A page address shared by two primitives, a page without geometry, a shared bundle.
  const primitiveA = {
    mesh: 0,
    primitive: 0,
    pages: [pageDe(0, 'p/0', 'g/0'), pageDe(1, 'p/1')],
    streams: { pages: [{ url: 'b/0' }, { url: 'b/1' }] },
  } as unknown as Primitive
  const primitiveB = {
    mesh: 1,
    primitive: 0,
    pages: [pageDe(2, 'p/1', 'g/1'), pageDe(3, 'p/2', 'g/0')], // 'p/1' and 'g/0' already seen elsewhere
    streams: { pages: [{ url: 'b/1' }] },
  } as unknown as Primitive
  return { primitives: [primitiveA, primitiveB] } as unknown as ClusterManifest
}

test('indexManifestPages deduplicates pages, geometries and bundles exactly like the reference flatMaps', () => {
  const metadata = manifestePartage()
  const actual = indexManifestPages(metadata)
  const expected = referenceIndexManifestPages(metadata)
  assert.deepEqual(actual.pages, expected.pages)
  assert.deepEqual(actual.geometryPages, expected.geometryPages)
  assert.deepEqual([...actual.geometryUrls], [...expected.geometryUrls])
  assert.deepEqual([...actual.pageIdByUrl], [...expected.pageIdByUrl])
})

test('indexManifestBundles deduplicates streaming bundles in their order of appearance', () => {
  const metadata = manifestePartage()
  assert.deepEqual(indexManifestBundles(metadata), referenceIndexManifestBundles(metadata))
})

test('a manifest with no page and no bundle yields empty indexes on both sides', () => {
  const empty = {
    primitives: [{ mesh: 0, primitive: 0, pages: [] }],
  } as unknown as ClusterManifest
  assert.deepEqual(indexManifestPages(empty), referenceIndexManifestPages(empty))
  assert.deepEqual(indexManifestBundles(empty), referenceIndexManifestBundles(empty))
})

test('pagesBounds boxes the exact page at the mesh position, a « coarse » page excluded, a mesh without association reported', () => {
  const geometry = new G.Geometry()
  const meshFound = G.mesh(geometry, G.basicSurface())
  const meshMissing = G.mesh(geometry, G.basicSurface())
  const source = new G.Group()
  source.add(meshFound, meshMissing)
  meshFound.position.set(2, 0, 0)
  const exact = pageDe(0, 'p/0')
  exact.max = [1, 1, 1]
  const grossiere = pageDe(1, 'p/1')
  grossiere.role = 'coarse'
  grossiere.min = [-100, -100, -100]
  grossiere.max = [100, 100, 100]
  const metadata = {
    primitives: [{ mesh: 0, primitive: 0, pages: [exact, grossiere] }],
  } as unknown as ClusterManifest
  const associations = new Map<G.HostMesh, { meshes: number; primitives: number }>([
    [meshFound, { meshes: 0, primitives: 0 }],
  ])
  const manques: G.HostMesh[] = []
  const actual = pagesBounds(source, associations, metadata, (m) =>
    manques.push(asHostLibrary<G.HostMesh>(m)),
  )
  assert.deepEqual(Array.from(actual), [2, 0, 0, 3, 1, 1])
  assert.deepEqual(manques, [meshMissing])
})

// Hostile matrices — negative scale, shear, zero z-row, NaN — under a depth-3 hierarchy, each box
// worked out by hand: the page box [-1,-2,-3]..[4,5,6] goes through `x' = x + 0.6 y + 2`,
// `y' = y + 3`, `z' = 0` (the sheared child), then the root's `x -> -3 x`.
function hostileScene(nanShift: boolean) {
  const geometry = new G.Geometry()
  const root = new G.Group()
  root.scale.set(-3, 1, 1)
  const child = new G.Group()
  child.matrixAutoUpdate = false
  child.matrix.set(1, 0.6, 0, 2, 0, 1, 0, 3, 0, 0, 0, 0, 0, 0, 0, 1)
  root.add(child)
  const singulier = G.mesh(geometry, G.basicSurface())
  child.add(singulier)
  const grandchild = new G.Group()
  grandchild.position.set(nanShift ? NaN : 0, 5, -0)
  child.add(grandchild)
  const profond = G.mesh(geometry, G.basicSurface())
  grandchild.add(profond)
  const source = new G.Group()
  source.add(root)
  const page = pageDe(0, 'p/0')
  page.min = [-1, -2, -3]
  page.max = [4, 5, 6]
  const metadata = {
    primitives: [
      { mesh: 0, primitive: 0, pages: [page] },
      { mesh: 1, primitive: 0, pages: [page] },
    ],
  } as unknown as ClusterManifest
  const boxOf = (mesh: G.HostMesh, manifestMesh: number) =>
    pagesBounds(
      source,
      new Map<G.HostMesh, { meshes: number; primitives: number }>([
        [mesh, { meshes: manifestMesh, primitives: 0 }],
      ]),
      metadata,
      () => {},
    )
  return { singulier, profond, boxOf }
}
const assertBox = (got: ArrayLike<number>, want: number[]) =>
  want.forEach((v, i) => assert.ok(Math.abs(got[i] - v) < 1e-12, `[${i}]: ${got[i]} vs ${v}`))

test('pagesBounds: a sheared, mirrored, zero-z-row parent flattens the box onto z = 0, and a deeper child follows its shifts', () => {
  const { singulier, profond, boxOf } = hostileScene(false)
  assertBox(boxOf(singulier, 0), [-27, 1, 0, 0.6, 8, 0])
  assertBox(boxOf(profond, 1), [-36, 6, 0, -8.4, 13, 0])
})

test('pagesBounds: a NaN position makes the whole box NaN, and leaves the sibling without it untouched', () => {
  const { singulier, profond, boxOf } = hostileScene(true)
  assertBox(boxOf(singulier, 0), [-27, 1, 0, 0.6, 8, 0])
  assert.ok(Array.from(boxOf(profond, 1)).every(Number.isNaN))
})

// Batch M4a: no allocation per page — one working buffer for the whole loop. Checked by passing
// the same `into` output from one call to the next: that is what comes back, never a new object.
test('pagesBounds reuses the `into` output instead of allocating one per page', () => {
  const geometry = new G.Geometry()
  const mesh = G.mesh(geometry, G.basicSurface())
  const source = new G.Group()
  source.add(mesh)
  const pages = Array.from({ length: 50 }, (_, i) => {
    const p = pageDe(i, `p/${i}`)
    p.min = [i, i, i]
    p.max = [i + 1, i + 1, i + 1]
    return p
  })
  const metadata = { primitives: [{ mesh: 0, primitive: 0, pages }] } as unknown as ClusterManifest
  const associations = new Map<G.HostMesh, { meshes: number; primitives: number }>([
    [mesh, { meshes: 0, primitives: 0 }],
  ])
  const into = emptyWorldBox()
  const rendered = pagesBounds(source, associations, metadata, () => {}, into)
  assert.equal(rendered, into, 'the same buffer instance comes back, whatever the number of pages')
})

// A mesh placed by rows is bounded by the box its rows place it in, before the view reads its
// primitive: the scene opens, and nothing is called missing.
test('pagesBounds bounds a mesh placed by rows whose primitive is not read yet by its box', () => {
  const placed = Object.assign(G.mesh(new G.Geometry(), G.basicSurface()), {
    boundingBox: { min: { x: -1, y: 0, z: -2 }, max: { x: 3, y: 4, z: 5 } },
  })
  const source = new G.Group()
  source.add(placed)
  const associations = new Map([
    [placed, { meshes: 7, primitives: 0, placements: createPlacementRows(1) }],
  ])
  const missing: unknown[] = []
  const metadata = { primitives: [] } as unknown as ClusterManifest
  const bounds = pagesBounds(source, associations, metadata, (mesh) => missing.push(mesh))
  assert.deepEqual([Array.from(bounds), missing], [[-1, 0, -2, 3, 4, 5], []])
})
