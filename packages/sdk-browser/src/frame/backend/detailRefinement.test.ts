import test from 'node:test'
import assert from 'node:assert/strict'
import { webgpuPagesEngine } from './pages.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { untag } from '../../../../../tests/kit/fakeDevice/fakeWebgpuDevice.ts'
import {
  backendOf,
  quadScene,
  camera,
  disposeQuadRun,
  flushedImage,
  streamingQuadBackend,
} from './testScenes.fixture.ts'
import { coarseQuadScene } from './coarseQuads.fixture.ts'
import { settledImage } from './settledImage.fixture.ts'
import { deepQuadScene } from './deepQuad.fixture.ts'
import type { EngineDiagnostic } from '../../diagnostic/types.ts'

test('detail replaces the complete GPU fallback only after every replacement is uploaded', async () => {
  installGpuGlobals()
  const fixture = coarseQuadScene(),
    { device } = fakeDevice(BACKEND)
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
    // The temporal pass draws every image until its history is whole (`taaConverging`): an image's
    // counts are read once its readback has landed.
    await flushedImage(backend)
    assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1'])
    assert.equal(backend.metrics().submittedTriangles, 2)
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

// A page cap of two streaming slots beside the root cover: the pool of the root region and the
// streaming slots holds both leaves, the finest level — the coarse page that stepped in is let
// go —, so the view draws the leaves and the budget has limited none of its detail. (The cut still
// asks for the coarse page the closure holds above them: more pages than the pool has, which is not
// a loss of detail while no cluster is drawn above the finest level.)
test('a refinement the GPU budget holds to the two leaves draws the finest level and reports no limit', async () => {
  installGpuGlobals()
  const fixture = deepQuadScene(),
    { device } = fakeDevice(BACKEND),
    events: EngineDiagnostic[] = []
  const backend = backendOf({
    ...fixture,
    gpuDevice: device,
    onDiagnostic: (event) => events.push(event),
  }) as ReturnType<typeof webgpuPagesEngine> & { selectedPageIds(): string[] }
  try {
    await backend.prepare()
    // The first image draws the root, and asks for the floor's page before any leaf; that page
    // enters the residency the image after its bytes, and the cut on it is read back one image
    // later (#1483): drawn and drained until the pose settles.
    await settledImage(backend)
    for (let i = 0; i < 4; i++) {
      await flushedImage(backend)
      assert.deepEqual(
        backend.selectedPageIds().sort(),
        ['0', '1'],
        'the leaves replace the root the view refuses',
      )
      assert.equal(backend.metrics().submittedTriangles, 2)
      assert.equal(backend.metrics().coverageBudgetLimited, false, 'the finest level is drawn')
      assert.deepEqual(backend.pendingUrls!(), [])
    }
  } finally {
    disposeQuadRun(backend, fixture)
  }
})

test('a failed initial page reader rejects preparation before exposing a partial scene', async () => {
  installGpuGlobals()
  const fixture = quadScene(),
    { device, draws } = fakeDevice(BACKEND)
  const backend = backendOf({
    ...fixture,
    indices: new Map(),
    readPage: async () => {
      throw new Error('PAGE_STREAM_FAILED')
    },
    gpuDevice: device,
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
    { device, passes, textureBufferCopies } = fakeDevice(BACKEND)
  const createBuffer = device.createBuffer.bind(device)
  let mapped!: () => void, release!: () => void
  const mapping = new Promise<void>((resolve) => {
    mapped = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  // The readback is held once the host has been asked for the pages: not at the first image.
  let holding = false
  device.createBuffer = (descriptor) => {
    const buffer = createBuffer(descriptor)
    if (untag(descriptor.label) === 'Trillion3D explicit capture') {
      const map = buffer.mapAsync.bind(buffer)
      buffer.mapAsync = async (...args) => {
        if (!holding) return map(...args)
        mapped()
        await gate
      }
    }
    return buffer
  }
  const backend = streamingQuadBackend(fixture, device)
  try {
    await backend.prepare()
    // The first image's cut is read back; the next one starts the pages it asks and the host is
    // asked for their bytes (`pendingUrls`).
    await flushedImage(backend)
    const copied = textureBufferCopies.length
    holding = true
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
    assert.equal(textureBufferCopies.length, copied + 1, 'the capture must not spin on updates')
    await flushedImage(backend)
    await flushedImage(backend)
    await flushedImage(backend)
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
