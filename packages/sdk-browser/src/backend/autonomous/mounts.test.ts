import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import type { Primitive } from '../../../../sdk-core/src/index.ts'
import { decodeGeometryPage } from '../../page/decode/geometryPage.ts'
import { liveRows, triangleBackend } from './triangle.fixture.ts'

/** The fixture's triangle as a resource of its own, at rank `mesh`, its page served at `url`. */
function resourceAt(paged: ReturnType<typeof triangleBackend>['paged'], mesh: number, url: string) {
  const [primitive] = paged.metadata.primitives
  const [page] = primitive.pages
  paged.encoded.set(url, paged.encoded.get(page.geometry!.url)!)
  const moved = { ...page, url, geometry: { ...page.geometry!, url } }
  return { ...primitive, mesh, pages: [moved] } as Primitive
}

test('a resource mounted in place is drawn once its cover is read, and unmounted leaves the rest', async () => {
  const placements = liveRows(1)
  const { backend, camera, geometry, material, paged } = triangleBackend({ placements })
  try {
    await backend.prepare()
    backend.updatePlacements!(placements, 0, 0) // the rows' roots indexed, as a running session
    backend.render(camera)
    const held = backend.metrics()
    assert.equal(held.submittedTriangles, 1)
    const mounts = [
      { url: 'triangle-geometry.bin', rows: liveRows(2) },
      { url: 'mounted-geometry.bin', rows: liveRows(3) },
    ].map(({ url, rows }, i) => {
      const node = G.mesh(geometry, G.basicSurface({ side: G.DOUBLE_SIDE }))
      const association = { meshes: i + 1, primitives: 0, placements: rows }
      return { node, association, primitive: resourceAt(paged, i + 1, url) }
    })
    const taken = mounts[1].association.placements
    taken.live.fill(0) // mounted parked, taken once drawn: the index must know its roots
    const mounting = mounts.map((mount) => backend.mountPlacements!(mount))
    backend.render(camera)
    assert.equal(backend.metrics().submittedTriangles, 1, 'nothing drawn before its cover is read')
    await Promise.all(mounting)
    taken.live.fill(1)
    backend.updatePlacements!(taken, 0, 2)
    backend.render(camera)
    assert.equal(backend.metrics().submittedTriangles, 6, 'every row of both resources drawn')
    assert.equal(backend.metrics().residentPages, 2, 'a page shared, a page of its own')
    for (const { association } of mounts) backend.unmountPlacements!(association.placements)
    backend.render(camera)
    const after = backend.metrics()
    assert.equal(after.submittedTriangles, 1, 'the resource the session opened with still drawn')
    assert.equal(after.residentPages, held.residentPages)
    assert.equal(after.geometryAllocationBytes, held.geometryAllocationBytes, 'every copy freed')
  } finally {
    backend.dispose()
    geometry.dispose()
    material.dispose()
  }
})

/** A resource of its own mounted beside the fixture's triangle in three rows, `url` its page. */
function mountBeside({ geometry, paged }: ReturnType<typeof triangleBackend>, url: string) {
  const node = G.mesh(geometry, G.basicSurface({ side: G.DOUBLE_SIDE }))
  const association = { meshes: 1, primitives: 0, placements: liveRows(3) }
  return { node, association, primitive: resourceAt(paged, 1, url) }
}

test('a mounted resource moves to the blended class with its surface, as an opened one does', async () => {
  const fixture = triangleBackend({ placements: liveRows(1) })
  const { backend, camera } = fixture
  try {
    await backend.prepare()
    const mount = mountBeside(fixture, 'mounted-geometry.bin')
    await backend.mountPlacements!(mount)
    backend.render(camera)
    const opaque = backend.metrics().drawCalls
    const surfaces = [mount.node.material]
    backend.refreshMaterials!(true, { surfaces, from: 'opaque', to: 'blend' })
    backend.render(camera)
    // Blended, each of its three rows is a draw of its own, no longer one instanced page.
    assert.equal(backend.metrics().drawCalls, Number(opaque) + 2)
    backend.refreshMaterials!(true, { surfaces, from: 'blend', to: 'opaque' })
    backend.render(camera)
    assert.equal(backend.metrics().drawCalls, opaque, 'and back to one instanced page')
  } finally {
    backend.dispose()
  }
})

test('a page the host replaced keeps its geometry when a mount comes to share it', async () => {
  const fixture = triangleBackend()
  const { backend, camera, encoded } = fixture
  try {
    await backend.prepare()
    const replaced = decodeGeometryPage(encoded.data)
    replaced.attributes.position[0] = -0.25
    backend.replaceGeometryPage!('triangle-geometry.bin', replaced)
    await backend.mountPlacements!(mountBeside(fixture, 'triangle-geometry.bin'))
    backend.render(camera)
    const drawn = backend.scene.children.filter(G.isDrawnNode)
    assert.ok(drawn.length >= 2, 'the opened triangle and the mounted rows')
    for (const node of drawn) assert.equal(node.geometry.getAttribute('position')!.getX(0), -0.25)
  } finally {
    backend.dispose()
  }
})

test('a geometry replaced forty times keeps the GPU memory of one (#411)', async () => {
  const fixture = triangleBackend({ placements: liveRows(1) })
  const { backend, camera } = fixture
  try {
    await backend.prepare()
    // A slider: each value a geometry of its own content, mounted, and the one it replaces gone.
    let worn: ReturnType<typeof mountBeside> | undefined,
      first: { residentPages: unknown; geometryAllocationBytes: unknown } | undefined
    for (let value = 0; value < 40; value++) {
      const next = mountBeside(fixture, `slider-${value}.bin`)
      await backend.mountPlacements!(next)
      if (worn) backend.unmountPlacements!(worn.association.placements)
      worn = next
      backend.render(camera)
      const { residentPages, geometryAllocationBytes, submittedTriangles } = backend.metrics()
      assert.equal(submittedTriangles, 4, `value ${value}: the opened triangle and three rows`)
      first ??= { residentPages, geometryAllocationBytes }
      assert.deepEqual({ residentPages, geometryAllocationBytes }, first, `value ${value}`)
    }
  } finally {
    backend.dispose()
  }
})

test('an instance whose copied rows were unmounted is removed without a throw (#1226)', async () => {
  const placements = liveRows(1)
  const { backend, camera, geometry, material } = triangleBackend({ placements })
  try {
    await backend.prepare()
    backend.addInstance!('copy', new G.Matrix4().elements.slice())
    backend.render(camera)
    // The instance's roots read the rows they copied: the unmount takes them with the session's.
    backend.unmountPlacements!(placements)
    assert.doesNotThrow(() => backend.removeInstance!('copy'))
    backend.render(camera)
    assert.equal(backend.metrics().submittedTriangles, 0)
  } finally {
    backend.dispose()
    geometry.dispose()
    material.dispose()
  }
})
