import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { dagFixture } from '../page/selection/dag.fixture.ts'
import { collectClusterPages } from '../page/selection/collect.ts'
import { createPrimitiveTemplates } from '../page/selection/template.ts'
import type { ClusterManifest, Primitive } from '../../../sdk-core/src/contracts/geometry.ts'
import { graphDraws } from '../page/selection/drawSource.ts'
import { rootWorldBox } from '../page/selection/rootWorld.ts'

/** The same primitive, given a one-leaf-node culling hierarchy. */
function primitiveWithCulling(metadata: ClusterManifest) {
  const primitive = metadata.primitives[0] as Primitive & {
    culling: { version: number; count: number; stride: number; nodes: number[] }
  }
  primitive.culling = {
    version: 1,
    count: 1,
    stride: 15,
    nodes: [-2, -0.5, 0, 2, 0.5, 0, 0, 0, 0, 2.3, 0.2, 0, 0, 0, primitive.pages.length],
  }
  return primitive
}

// Behaviour: one template per primitive. Two calls yield the same pages, the same hierarchy and
// the same bounds, and a page whose index array contradicts the count its manifest entry
// declares is refused where the template is built.
test('a primitive’s template is computed once and returned as-is to the next placement', () => {
  const fixture = dagFixture()
  const primitive = primitiveWithCulling(fixture.metadata)
  const templates = createPrimitiveTemplates(fixture.indices, false)
  const first = templates.pagesOf(primitive),
    second = templates.pagesOf(primitive)
  assert.equal(second, first)
  const shape = templates.shapeOf(primitive, first)
  assert.equal(templates.shapeOf(primitive, second), shape)
  assert.ok(shape.culling && shape.bounds)
  // A page shorter than its manifest entry is refused at the template that reads it.
  const short = new Map(fixture.indices)
  const head = primitive.pages[0]
  short.set(head.url, new Uint32Array(head.count + 3))
  assert.throws(() => createPrimitiveTemplates(short, false).pagesOf(primitive), {
    message: 'Incomplete cluster coverage',
  })
})

// Behaviour: two instances of an object share the shape of its DAG — hierarchy, per-node bounds,
// group links, cluster identities — and never what places them: world matrix, world box. The
// local box belongs to the primitive and is shared, read never written.
test('two instances share the DAG shape, never what places them', () => {
  const fixture = dagFixture()
  primitiveWithCulling(fixture.metadata)
  const second = G.mesh(fixture.mesh.geometry, fixture.mesh.material)
  second.position.set(50, 0, 0)
  fixture.source.add(second)
  fixture.associations.set(second, { meshes: 0, primitives: 0 })
  const { roots, allPages } = collectClusterPages(
    fixture.source,
    graphDraws(fixture.source, fixture.associations),
    fixture.metadata,
    fixture.indices,
  )
  assert.equal(roots.length, 2)
  // One record per primitive page per placement: this object has its own pages.
  assert.equal(allPages.length, roots[0].pages.length * 2)
  assert.equal(roots[0].culling!.nodes, roots[1].culling!.nodes)
  assert.equal(roots[0].culling!.bounds, roots[1].culling!.bounds)
  assert.equal(roots[0].structure, roots[1].structure)
  // The local box belongs to the primitive, read never written: the instances share it.
  assert.equal(roots[0].localBox, roots[1].localBox)
  assert.deepEqual(Array.from(roots[0].localBox!), Array.from(roots[1].localBox!))
  assert.notEqual(roots[0].world, roots[1].world)
  assert.notDeepEqual(Array.from(rootWorldBox(roots[0])!), Array.from(rootWorldBox(roots[1])!))
  for (let i = 0; i < roots[0].pages.length; i++) {
    const a = roots[0].pages[i],
      b = roots[1].pages[i]
    assert.notEqual(a, b)
    // A cluster's identity is the primitive's: one string for all its placements.
    assert.equal(a.clusterId, b.clusterId)
    assert.equal(a.sphere, b.sphere)
    assert.equal(a.lodError, b.lodError)
  }
})
