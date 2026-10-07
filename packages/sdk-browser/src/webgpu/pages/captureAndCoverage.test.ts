import test from 'node:test'
import assert from 'node:assert/strict'
import { webgpuPagesEngine } from './pages.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import {
  quadScene,
  camera,
  assertBothQuadPagesDrawn,
  disposeQuadRun,
  flushedImage,
} from './testScenes.fixture.ts'
import { settledImage } from './settledImage.fixture.ts'
import { twoCoarseQuadsScene } from './testOccluder.fixture.ts'
import { deepQuadScene } from './deepQuad.fixture.ts'
import type { Engine } from '../../engine/types.ts'
import {
  DEFAULT_SCOPE,
  type ClusterManifest,
  type Primitive,
} from '../../../../sdk-core/src/index.ts'

test('a surface capture blocks external renders while its own view is drawn, and not after', async () => {
  installGpuGlobals()
  const { device } = mockGpu()
  const fixture = quadScene()
  const main = camera()
  let capturing = false,
    blocked: unknown
  const backend = webgpuPagesEngine({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    onDiagnostic(event) {
      // The capture view's targets are granted: that view is the one drawn now.
      if (capturing && event.phase === 'frame-allocation')
        try {
          backend.render(main)
          blocked = false
        } catch (error) {
          blocked = String(error)
        }
    },
  })
  try {
    await backend.prepare()
    backend.render(main)
    await backend.flush()
    capturing = true
    const surface = await backend.captureSurfaceView!(camera(), { width: 16, height: 16 })
    capturing = false
    surface.dispose()
    assert.match(String(blocked), /SURFACE_CAPTURE_BUSY/)
    // The main view never left its targets: it draws at once, nothing to restore.
    backend.render(main)
    assert.equal(backend.metrics().submittedTriangles, 2)
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test('a failed transparent material pipeline refuses the scene by name, never drawing another image', async () => {
  installGpuGlobals()
  const { device } = mockGpu()
  const fixture = quadScene()
  fixture.material.transparent = true
  fixture.material.opacity = 0.5
  fixture.metadata.primitives[0].pass = 'shared-blend'
  const create = device.createRenderPipeline.bind(device)
  device.createRenderPipeline = (descriptor) => {
    const target = descriptor.fragment ? [...descriptor.fragment.targets][0] : undefined
    if (descriptor.vertex.entryPoint === 'vs' && target?.format === 'rgba16float')
      throw new Error('NO_FORWARD_MATERIAL')
    return create(descriptor)
  }
  const backend = webgpuPagesEngine({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  })
  try {
    await assert.rejects(
      backend.prepare(),
      /WEBGPU_BLEND_PIPELINE_UNAVAILABLE|WEBGPU_MATERIAL_PIPELINE_UNAVAILABLE|NO_FORWARD_MATERIAL/,
    )
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test('camera jumps and obsolete uploads preserve coverage while detail slots are reclaimed', async () => {
  installGpuGlobals()
  const { device } = mockGpu(),
    fixture = twoCoarseQuadsScene(deepQuadScene)
  // `twoCoarseQuadsScene` rebuilds `metadata` with only `primitives`, itself narrowed to `{url}`
  // pages by an inner callback's own annotation: the real page objects it spreads keep every
  // field at runtime, only their perceived type loses them. The rest of `ClusterManifest` is
  // never read past `primitives`, so the rest is filled with placeholders.
  const metadata: ClusterManifest = {
    schema: 0,
    status: 'ready',
    key: 'test-two-coarse-quads',
    scope: DEFAULT_SCOPE,
    sourceTriangles: 0,
    selectedTriangles: 0,
    selectedNodes: 0,
    totalNodes: 0,
    primitives: fixture.metadata.primitives as Primitive[],
  }
  const backend = webgpuPagesEngine({
    ...fixture,
    metadata,
    gpuDevice: device,
    maxResidentPages: 6,
    viewport: [32, 32],
  }) as Engine
  const cam = camera()
  const aim = (x: number) => {
    cam.position.set(x, 0, 5)
    cam.lookAt(x, 0, 0)
    cam.updateMatrixWorld()
  }
  /** The camera at `x`, drawn and drained until an image counts the readback cut under that pose
   *  on the residency in place (#1483): it covers the quad whole — its two triangles, coarse or
   *  fine —, whatever is still on its way. */
  const settle = async (x: number) => {
    aim(x)
    await settledImage(backend, cam, { arrived: false })
    assert.equal(backend.metrics().submittedTriangles, 2)
    return backend.selectedPageIds().sort()
  }
  /** Settles at `x` until the detail cut `expected` is drawn; every pose on the way covers. */
  const converge = async (x: number, expected: string[]) => {
    for (let step = 0; step < 8; step++) if ((await settle(x)).join() === expected.join()) return
    assert.deepEqual(backend.selectedPageIds().sort(), expected, 'the detail cut converges')
  }
  try {
    await backend.prepare()
    await converge(0, ['0', '1'])
    assert.deepEqual(await settle(100), ['b3'], 'the root cover stands in on arrival')
    await converge(100, ['b0', 'b1'])
    // Jumps faster than the uploads: each pose's requests go obsolete before they land.
    for (let i = 0; i < 12; i++) {
      aim(i % 2 ? 100 : 0)
      backend.render(cam)
      await Promise.resolve()
    }
    await converge(0, ['0', '1'])
    assert.ok(backend.metrics().cacheEvictions! > 0)
  } finally {
    backend.dispose()
    fixture.dispose()
  }
})

test('a visible opaque primitive without a hierarchy still has complete exact-page coverage', async () => {
  installGpuGlobals()
  const fixture = quadScene(),
    { device } = mockGpu()
  const backend = webgpuPagesEngine({
    ...fixture,
    metadata: { ...fixture.metadata, primitives: [{ ...fixture.metadata.primitives[0] }] },
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  }) as Engine
  try {
    await backend.prepare()
    await flushedImage(backend)
    assertBothQuadPagesDrawn(backend)
  } finally {
    disposeQuadRun(backend, fixture)
  }
})
