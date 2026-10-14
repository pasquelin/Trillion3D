import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
import { Group } from '../../../sdk-core/src/world/object/object3d.ts'
import type { ClusterManifest } from '../../../sdk-core/src/contracts/geometry.ts'
import { collectClusterPages } from '../page/selection/collect.ts'
import { dagRoots, DAG, exactPrimitive } from './pagesEngine.fixture.ts'
import { graphDraws } from '../page/selection/drawSource.ts'

test('transmissive materials stay as unsplit source meshes even when the cache pass is exact-clusters', () => {
  const geometry = new Geometry()
  geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0], 3))
  geometry.setIndex(G.indices([0, 1, 2]))
  const material = G.physicalSurface({
    transmission: 1,
    thickness: 0.02,
    roughness: 0,
  })
  const mesh = G.mesh(geometry, material),
    source = new Group()
  source.add(mesh)
  const pages = [
    { id: 0, url: '0', count: 3, min: [-1, -1, 0], max: [1, 1, 0], bytes: 12, sha256: 'x' },
  ]
  const manifest: ClusterManifest = {
    ...DAG,
    schema: 1,
    status: 'ready',
    key: 'k',
    scope: 'full',
    sourceTriangles: 0,
    selectedTriangles: 0,
    selectedNodes: 0,
    totalNodes: 0,
    primitives: [exactPrimitive(dagRoots(pages))],
  }
  const indices = new Map([['0', new Uint32Array([0, 1, 2])]]),
    associations = new Map([[mesh, { meshes: 0, primitives: 0 }]])
  const collected = collectClusterPages(source, graphDraws(source, associations), manifest, indices)
  assert.equal(collected.allPages.length, 0)
  assert.equal(collected.blendCopies.length, 1)
  // The collection hands out the ENGINE's own record: the geometry and the surface record of the
  // source mesh, and the mesh itself only as the identity the record stands for.
  const record = collected.blendCopies[0]
  assert.equal(record.geometry, geometry)
  assert.equal(record.userData.drawSource?.node, mesh)
  assert.equal(record.surface.transmission, 1)
  geometry.dispose()
  material.dispose()
})
