// A material moved to or from blended inside the session: the WebGL2 display graph sorts
// its meshes by surface at every draw, and the one family its open fixed — a record rows place is
// drawn instanced unless blended, whose instances the host orders one by one — follows the move.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { drawnPageMeshes, liveRows, triangleBackend } from './triangle.fixture.ts'

test('WebGL2 draws the rows of a material turned blended one by one, and instanced once opaque again', async () => {
  const { backend, camera, geometry, material } = triangleBackend({ placements: liveRows(2) })
  const meshes = (to: 'blend' | 'opaque', classMoved = true) => {
    const from = material.transparent ? 'blend' : 'opaque'
    material.transparent = to === 'blend'
    material.needsUpdate = true
    backend.refreshMaterials!(true, classMoved ? { surfaces: [material], from, to } : undefined)
    backend.render(camera)
    return backend.metrics().drawCalls
  }
  try {
    await backend.prepare()
    backend.render(camera)
    assert.equal(backend.metrics().drawCalls, 1, 'opaque: one instanced mesh for both rows')
    assert.equal(meshes('blend'), 2, 'blended: one mesh per row, each sorted by its depth')
    assert.equal(meshes('opaque'), 1, 'opaque again: instanced')
    assert.equal(meshes('blend', false), 1, 'a values refresh alone moves no record')
  } finally {
    backend.dispose()
    geometry.dispose()
    material.dispose()
  }
})

// The page ceiling counts what an instance adds to the cover: one mesh per record drawn on its own.
// Once the rows' material turned blended, each row's record is one, and an instance adds two.
test('the page ceiling counts an instance of a material turned blended by its own meshes', async () => {
  const material = G.basicSurface({ side: G.DOUBLE_SIDE })
  const { backend, camera, geometry } = triangleBackend({ placements: liveRows(2) }, material, {
    maxResidentPages: 3,
  })
  const pose = new G.Matrix4().toArray() as unknown as Float64Array
  try {
    await backend.prepare()
    backend.addInstance!('opaque', Float64Array.from(pose))
    backend.removeInstance!('opaque')
    material.transparent = true
    material.needsUpdate = true
    backend.refreshMaterials!(true, { surfaces: [material], from: 'opaque', to: 'blend' })
    backend.render(camera)
    // Two meshes the cover hangs and two the instance would add: past a ceiling of three.
    assert.throws(
      () => backend.addInstance!('blended', Float64Array.from(pose)),
      /AUTONOMOUS_ROOT_BUDGET/,
    )
  } finally {
    backend.dispose()
    geometry.dispose()
    material.dispose()
  }
})

/** The meshes the display graph draws, each told by its instanced rows and its blending: the
 *  family of each record, as a frame reads it. */
const families = (triangle: ReturnType<typeof triangleBackend>) =>
  drawnPageMeshes(triangle)
    .map(
      (mesh) =>
        `${'count' in mesh ? 'instanced' : 'one'}:${(mesh.material as { transparent: boolean }).transparent}`,
    )
    .sort()

// A primitive moved between blended and opaque inside the session draws in the family of its new
// class, as a fresh session of the compile of that class draws it: a primitive the compiler
// cut blended leaves the blended family once opaque, and the reverse.
for (const [pass, from, to, other] of [
  ['clustered-blend', 'blend', 'opaque', 'exact-clusters'],
  ['exact-clusters', 'opaque', 'blend', 'clustered-blend'],
] as const)
  test(`WebGL2 draws a ${from} primitive turned ${to} in the family of a fresh ${to} session`, async () => {
    const moved = triangleBackend({ placements: liveRows(2), pass })
    const fresh = triangleBackend({ placements: liveRows(2), pass: other })
    const move = (a: typeof from | typeof to, b: typeof from | typeof to) => {
      moved.material.transparent = b === 'blend'
      moved.material.needsUpdate = true
      moved.backend.refreshMaterials!(true, { surfaces: [moved.material], from: a, to: b })
    }
    try {
      moved.material.transparent = from === 'blend'
      fresh.material.transparent = to === 'blend'
      await Promise.all([moved.backend.prepare(), fresh.backend.prepare()])
      const open = families(moved)
      move(from, to)
      await moved.backend.flush!()
      assert.deepEqual(families(moved), families(fresh), `the ${to} family of a fresh session`)
      move(to, from)
      await moved.backend.flush!()
      assert.deepEqual(families(moved), open, 'back: the family it opened in')
    } finally {
      for (const { backend, geometry, material } of [moved, fresh]) {
        backend.dispose()
        geometry.dispose()
        material.dispose()
      }
    }
  })
