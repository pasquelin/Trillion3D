import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../../host/graph/graph.fixture.ts'
import { webgpuPagesEngine } from '../pages.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts'
import { quadScene, camera, quadBackend } from '../testScenes.fixture.ts'

test('opaque materials are rendered before lighting into reusable GPU surface textures', async () => {
  installGpuGlobals()
  const { device, passes } = mockGpu()
  const { fixture, backend } = quadBackend(device)
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    backend.render(camera())
    // The four surfaces, the flags in `r8uint` last: the quad wears no texture, so no feedback
    // target follows them (`feedbackVariant.ts`).
    const surface = passes.findIndex(
      (pass) => pass.formats.length === 4 && pass.formats[3] === 'r8uint',
    )
    const lighting = passes.findIndex(
      (pass, i) => i > surface && pass.formats.length === 1 && pass.formats[0] === 'rgba16float',
    )
    assert.ok(surface >= 0, 'material pass must write surface properties')
    assert.ok(lighting > surface, 'lighting must consume the material pass')
    assert.equal(backend.metrics().vramBytes, null, 'allocation arithmetic is not physical VRAM')
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

test('surface capture uses its own camera and leaves the main view untouched, without copying pixels to CPU', async () => {
  installGpuGlobals()
  const { device, imageCopies } = mockGpu()
  const fixture = quadScene()
  const viewport: [number, number] = [32, 32]
  const backend = webgpuPagesEngine({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport,
  })
  try {
    await backend.prepare()
    const main = camera()
    backend.render(main)
    await backend.flush()
    backend.render(main)
    await backend.flush()
    const before = await backend.capture()
    const other = camera()
    other.position.x = 1
    other.lookAt(0, 0, 0)
    other.updateMatrixWorld()
    assert.equal(typeof backend.captureSurfaceView, 'function')
    imageCopies.length = 0
    const surface = await backend.captureSurfaceView!(other, { width: 16, height: 16 })
    assert.equal(surface.version, 1)
    assert.deepEqual(surface.cameraWorld, [1, 0, 5])
    assert.equal(surface.width, 16)
    assert.equal(surface.selectedTriangles, 2)
    assert.deepEqual(viewport, [32, 32])
    assert.deepEqual(G.xyz(main.position), [0, 0, 5])
    assert.equal(imageCopies.length, 0, 'secondary views must remain GPU textures')
    await assert.rejects(
      () => backend.captureSurfaceView!(other, { width: 16, height: 16 }),
      /SURFACE_CAPTURE_BUSY/,
    )
    surface.dispose()
    await backend.flush()
    assert.deepEqual(await backend.capture(), before)
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

test('an explicit capture reads an unflushed image back, and an aborted surface capture leaves the main view intact', async () => {
  installGpuGlobals()
  const { device } = mockGpu()
  const { fixture, backend } = quadBackend(device)
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    assert.equal((await backend.capture()).length, 4096)
    backend.render(camera())
    // No flush: the capture reads the image of this render back itself.
    assert.equal((await backend.capture()).length, 4096)
    assert.equal(typeof backend.captureSurfaceView, 'function')
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      () =>
        backend.captureSurfaceView!(camera(), { width: 16, height: 16, signal: controller.signal }),
      /abort/i,
    )
    await backend.flush()
    assert.equal((await backend.capture()).length, 4096)
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

test('surface capture rejects missing pages and a device-limit failure keeps the main viewport', async () => {
  installGpuGlobals()
  const { device } = mockGpu()
  const fixture = quadScene()
  const viewport: [number, number] = [32, 32]
  const backend = webgpuPagesEngine({
    ...fixture,
    indices: new Map(),
    gpuDevice: device,
    maxResidentPages: 2,
    viewport,
  })
  try {
    await backend.prepare()
    backend.render(camera())
    await assert.rejects(
      () => backend.captureSurfaceView!(camera(), { width: 16, height: 16 }),
      /SURFACE_PAGES_NOT_RESIDENT/,
    )
    assert.deepEqual(viewport, [32, 32])
    await assert.rejects(
      () => backend.captureSurfaceView!(camera(), { width: 8193, height: 100 }),
      /SURFACE_DEVICE_LIMIT/,
    )
    assert.deepEqual(viewport, [32, 32])
    // The main view draws on, waiting for a cover no page brings: no cut was read back, so its
    // counts are unknown, never a measured zero (#1483).
    backend.render(camera())
    assert.equal(backend.metrics().submittedTriangles, null)
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})
