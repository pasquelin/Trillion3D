import test from 'node:test'
import assert from 'node:assert/strict'
import { webgpuPagesEngine } from './pages.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { untag } from '../../../../../tests/kit/gpu/fakeWebgpuDevice.ts'
import {
  quadScene,
  camera,
  assertBothQuadPagesDrawn,
  disposeQuadRun,
  flushedImage,
  streamingQuadBackend,
} from './testScenes.fixture.ts'
import { coarseQuadScene } from './testOccluder.fixture.ts'
import { settledImage } from './settledImage.fixture.ts'
import { deepQuadScene } from './deepQuad.fixture.ts'
import type { EngineDiagnostic } from '../../engine/types.ts'

test('detail replaces the complete GPU fallback only after every replacement is uploaded', async () => {
  installGpuGlobals()
  const fixture = coarseQuadScene(),
    { device } = mockGpu()
  const backend = streamingQuadBackend(fixture, device) as ReturnType<typeof webgpuPagesEngine> & {
    selectedPageIds(): string[]
  }
  try {
    await backend.prepare()
    // The GPU cut's readback lands one image later (#1483): each pose is drawn, then flushed.
    await flushedImage(backend)
    assert.deepEqual(backend.selectedPageIds(), ['2'])
    backend.acceptPage('0', fixture.indices.get('0')!)
    backend.syncResident()
    await backend.flush()
    await flushedImage(backend)
    backend.render(camera())
    assert.deepEqual(
      backend.selectedPageIds(),
      ['2'],
      'one GPU detail page cannot replace the full fallback',
    )
    backend.dropPage('2')
    backend.dropPage('0')
    backend.acceptPage('1', fixture.indices.get('1')!)
    backend.syncResident()
    assert.deepEqual(backend.selectedPageIds(), ['2'], 'CPU arrival is not GPU residency')
    await backend.flush()
    await flushedImage(backend)
    await flushedImage(backend)
    assertBothQuadPagesDrawn(backend)
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

// #1237: a page cap under the pool's floor draws that floor — the root cover and the pages its
// groups replace —: the coarse page stands in for the leaves, never the root the view refuses.
test('a refinement exceeding the GPU budget keeps the floor, not the refused root, and reports the limit', async () => {
  installGpuGlobals()
  const fixture = deepQuadScene(),
    { device } = mockGpu(),
    events: EngineDiagnostic[] = []
  const backend = webgpuPagesEngine({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    onDiagnostic: (event) => events.push(event),
  }) as ReturnType<typeof webgpuPagesEngine> & { selectedPageIds(): string[] }
  try {
    await backend.prepare()
    const floor = events.find(({ phase }) => phase === 'minimum-capacity')?.context
    assert.deepEqual([floor?.rootPages, floor?.floorPages], [1, 2], 'what the floor costs, said')
    // The first image draws the root, and asks for the floor's page before any leaf; that page
    // enters the residency the image after its bytes, and the cut on it is read back one image
    // later (#1483): drawn and drained until the pose settles.
    await settledImage(backend)
    for (let i = 0; i < 4; i++) {
      backend.render(camera())
      assert.deepEqual(backend.selectedPageIds(), ['2'], 'the root the view refuses is replaced')
      assert.equal(backend.metrics().submittedTriangles, 2)
      assert.equal(backend.metrics().coverageBudgetLimited, true)
      assert.deepEqual(backend.pendingUrls!(), [])
      await backend.flush()
    }
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test('a failed initial page reader rejects preparation before exposing a partial scene', async () => {
  installGpuGlobals()
  const fixture = quadScene(),
    { device, draws } = mockGpu()
  const backend = webgpuPagesEngine({
    ...fixture,
    indices: new Map(),
    readPage: async () => {
      throw new Error('PAGE_STREAM_FAILED')
    },
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  })
  try {
    await assert.rejects(backend.prepare(), /PAGE_STREAM_FAILED/)
    assert.equal(draws.length, 0)
    assert.equal(backend.metrics().coverageReady, false)
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test('streaming completion during image readback preserves the captured frame and resumes on render', async () => {
  installGpuGlobals()
  const fixture = coarseQuadScene(),
    { device, passes, imageCopies } = mockGpu()
  const createBuffer = device.createBuffer.bind(device)
  let mapped!: () => void, release!: () => void
  const mapping = new Promise<void>((resolve) => {
    mapped = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  device.createBuffer = (descriptor) => {
    const buffer = createBuffer(descriptor)
    if (untag(descriptor.label) === 'Trillion3D explicit capture')
      buffer.mapAsync = async () => {
        mapped()
        await gate
      }
    return buffer
  }
  const backend = streamingQuadBackend(fixture, device)
  try {
    await backend.prepare()
    backend.render(camera())
    const flushing = backend.flush()
    await mapping
    const before = passes.length
    assert.deepEqual(backend.pendingUrls?.().sort(), ['0', '1'])
    for (const [url, array] of fixture.indices) backend.acceptPage(url, array)
    backend.syncResident()
    backend.syncResident()
    release()
    await flushing
    assert.equal(passes.length, before, 'streaming must not overwrite an image being captured')
    assert.equal((await backend.capture()).length, 32 * 32 * 4)
    assert.deepEqual(backend.pendingUrls?.(), [], 'pages arriving during capture remain accepted')
    assert.equal(imageCopies.length, 1, 'the capture must not spin on streaming updates')
    await flushedImage(backend)
    await flushedImage(backend)
    backend.render(camera())
    assert.equal(
      backend.metrics().submittedTriangles,
      2,
      'accepted geometry is rendered on subsequent frames',
    )
  } finally {
    release()
    disposeQuadRun(backend, fixture)
  }
})
