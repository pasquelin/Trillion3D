import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import type { HostMesh } from '../../host/resources.ts'
import { webgpuPagesEngine } from './pages.ts'
import { installGpuGlobals, transparentDraws } from '../../../../../tests/kit/gpu/globals.ts'
import { BACKEND } from '../../../../../tests/kit/gpu/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { quadScene, camera, quadBackend } from './testScenes.fixture.ts'
import { createTextureCaches } from '../../texture/textureCaches.ts'
import { createPageCache } from '../../streaming/pageCache.ts'

test('a host diagnostic exception cannot break GPU initialization or rendering', async () => {
  installGpuGlobals()
  const { device } = fakeDevice(BACKEND)
  const { fixture, backend } = quadBackend(device, {
    onDiagnostic() {
      throw new Error('HOST_LOG_FAILURE')
    },
  })
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    backend.render(camera())
    assert.equal(backend.metrics().submittedTriangles, 2)
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

test('transparent frustum selection preserves intersections and transformed bounds', async () => {
  installGpuGlobals()
  const cases = [
    { name: 'in view', position: [0, 0, 0], visible: true },
    { name: 'right', position: [100, 0, 0], visible: false },
    { name: 'left', position: [-100, 0, 0], visible: false },
    { name: 'above', position: [0, 100, 0], visible: false },
    { name: 'below', position: [0, -100, 0], visible: false },
    { name: 'behind', position: [0, 0, 10], visible: false },
    { name: 'past far plane', position: [0, 0, -110], visible: false },
    { name: 'partly in view', position: [3, 0, 0], visible: true },
    { name: 'near plane intersection', position: [0, 0, 4.9], rotate: true, visible: true },
    { name: 'mirrored nonuniform scale', position: [4, 0, 0], scale: [-4, 2, 1], visible: true },
    // Its clusters are culled by the cut on their bounds, which hold every vertex they draw: the
    // host's opt-out keeps nothing in view that the cut can see is out.
    { name: 'disabled culling', position: [100, 0, 0], unculled: true, visible: false },
  ]
  for (const item of cases) {
    const fixture = quadScene(),
      { device, draws } = fakeDevice(BACKEND),
      mesh = fixture.source.children[0] as HostMesh
    fixture.material.transparent = true
    G.sided(fixture.material, G.DOUBLE_SIDE)
    mesh.position.fromArray(item.position)
    if (item.scale) mesh.scale.fromArray(item.scale)
    if (item.rotate) mesh.rotation.y = 0.5
    mesh.frustumCulled = !item.unculled
    fixture.source.updateMatrixWorld(true)
    const backend = webgpuPagesEngine({
      textureCaches: createTextureCaches(createPageCache()),
      ...fixture,
      gpuDevice: device,
      maxResidentPages: 2,
      viewport: [32, 32],
    })
    try {
      await backend.prepare()
      // The image's counts are the GPU cut's, read back: the image after its readback.
      backend.render(camera())
      await backend.flush()
      draws.length = 0
      backend.render(camera())
      const metrics = backend.metrics()
      // The scene carries its item and the cut writes the instance count of each draw: an item's
      // slot is encoded as in view — one draw for both faces, its vertex stage culling each
      // (`../blend/planEntry.ts`) —, an item the cut left without a cluster leaves it without an
      // instance, a partly visible item keeps both faces. The reject count is read back on its own.
      const selected = item.visible ? 2 : 0
      assert.equal(metrics.submittedTriangles, selected, item.name)
      assert.equal(metrics.transparentMeshes, 1, item.name)
      assert.equal(metrics.transparentFrustumRejected, item.visible ? 0 : 1, item.name)
      assert.equal(metrics.transparentDrawCalls, 1, item.name)
      assert.equal(metrics.transparentSubmittedTriangles, selected, item.name)
      const actual = transparentDraws(draws)
      assert.equal(actual.length, 1, item.name + ' actual GPU commands, encoded as in view')
      assert.equal(
        actual.reduce((sum, draw) => sum + ((draw.instanceCount ?? 0) * draw.vertexCount) / 3, 0),
        item.visible ? 4 : 0,
        item.name + ' triangles actually drawn',
      )
    } finally {
      backend.dispose()
      fixture.geometry.dispose()
      fixture.material.dispose()
    }
  }
})

test('transparent selection follows each camera without retaining an old rejected list', async () => {
  installGpuGlobals()
  const fixture = quadScene(),
    { device, draws } = fakeDevice(BACKEND)
  fixture.material.transparent = true
  const backend = webgpuPagesEngine({
    textureCaches: createTextureCaches(createPageCache()),
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  })
  // Triangles the last image actually drew: the plan is the same from one image to the next,
  // only the instance count the cut writes changes.
  const dessines = () => {
    const image = transparentDraws(draws.splice(0, draws.length))
    return image.reduce((sum, draw) => sum + ((draw.instanceCount ?? 0) * draw.vertexCount) / 3, 0)
  }
  try {
    await backend.prepare()
    const cam = camera()
    // Each view's image after its cut's readback: the counts are the GPU's.
    const image = async () => {
      backend.render(cam)
      await backend.flush()
      draws.length = 0
      backend.render(cam)
    }
    await image()
    assert.equal(backend.metrics().submittedTriangles, 2)
    assert.equal(dessines(), 2)
    cam.lookAt(100, 0, 5)
    cam.updateMatrixWorld()
    await image()
    assert.equal(backend.metrics().transparentFrustumRejected, 1, 'the frustum rejects')
    assert.equal(dessines(), 0, 'the turned-away camera draws nothing')
    cam.lookAt(0, 0, 0)
    cam.updateMatrixWorld()
    await image()
    assert.equal(backend.metrics().transparentFrustumRejected, 0, 'no leftover reject list')
    assert.equal(dessines(), 2, 'the item comes back having lost nothing')
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})
