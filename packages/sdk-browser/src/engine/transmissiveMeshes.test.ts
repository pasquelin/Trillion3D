import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
import { Group } from '../../../sdk-core/src/world/object/object3d.ts'
import type { ClusterManifest } from '../../../sdk-core/src/contracts/geometry.ts'
import { collectClusterPages } from '../page/selection/collect.ts'
import { dagRoots, DAG, exactPrimitive } from './pagesEngine.fixture.ts'
import { graphDraws } from '../page/selection/drawSource.ts'

test('a transmissive material on exact-clusters streams its pages, drawn blended, no source copy', () => {
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
    formatVersion: 1,
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
  // Its pages stream and coarsen as any, the transparent pass composing them: no whole-mesh copy.
  assert.equal(collected.allPages.length, 1)
  const [record] = collected.allPages
  assert.equal(record.transparent, true, 'drawn blended')
  assert.equal(record.drawSource?.node, mesh)
  assert.equal(record.material.transmission, 1)
  geometry.dispose()
  material.dispose()
})
