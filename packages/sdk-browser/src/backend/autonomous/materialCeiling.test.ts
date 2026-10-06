// A material placed by rows turned blended inside the session (#846): each row becomes a mesh of
// its own, and past the host page ceiling the move is refused by name before any write, by the
// check the open and every instance run (`AUTONOMOUS_ROOT_BUDGET`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { preparedMaterials } from '../../host/prepared/materials.ts'
import { createExplorerMaterialApi } from '../../world/api/materialApi.ts'
import { entry } from '../../world/api/materialApi.fixture.ts'
import { liveRows, triangleBackend } from './triangle.fixture.ts'

test('WebGL2 refuses a class change that would take the cover past the host ceiling', async () => {
  const plain = { vertexColors: false, flatShading: false }
  const surface = await preparedMaterials([entry({})], async () => null)(0, plain)
  const { backend, camera, geometry, mesh, source } = triangleBackend(
    { placements: liveRows(3) },
    surface,
  )
  const api = createExplorerMaterialApi({
    check: () => {},
    source,
    associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]),
    backends: [backend],
    active: () => backend,
  })
  const drawn = () => (backend.render(camera), backend.metrics().drawCalls)
  try {
    await backend.prepare()
    assert.equal(drawn(), 1, 'opaque: the three rows are one instanced mesh, under two pages')
    const version = surface.version
    assert.throws(
      () => api.setMaterial('0', { alphaMode: 'blend' }),
      (error: { code?: string; message: string; details?: { engine?: string } }) =>
        error.code === 'MATERIAL_CLASS_CHANGE' &&
        error.details?.engine === 'autonomous-pages-webgl' &&
        error.message.includes('AUTONOMOUS_ROOT_BUDGET'),
    )
    assert.equal(surface.version, version, 'nothing written')
    assert.equal(api.material('0').alphaMode, 'opaque')
    assert.equal(drawn(), 1, 'nothing reassigned: still one instanced mesh')
    assert.equal(api.setMaterial('0', { alphaMode: 'mask' }), true, 'a cutout stays instanced')
  } finally {
    backend.dispose()
    geometry.dispose()
    surface.dispose()
  }
})
