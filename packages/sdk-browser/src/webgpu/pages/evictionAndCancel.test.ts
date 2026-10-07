import test from 'node:test'
import assert from 'node:assert/strict'
import { webgpuPagesEngine } from './pages.ts'
import { collectClusterPages } from '../../page/selection/selection.ts'
import { packDagSelection } from '../../gpu/dag/selection.ts'
import { drawnPageIds, installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { dagLevel } from '../../engine/pagesEngine.fixture.ts'
import { quadScene, camera, flushedImage } from './testScenes.fixture.ts'
import { coarseQuadScene } from './testOccluder.fixture.ts'
import { settledImage } from './settledImage.fixture.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'
import type { Engine } from '../../engine/types.ts'
import { LAST_USE_WINDOW } from '../residency/lastUseWindow.ts'

test('a host eviction deferred for coverage is applied once the page is no longer pinned', async () => {
  installGpuGlobals()
  const fixture = coarseQuadScene(),
    { device } = mockGpu()
  const backend = webgpuPagesEngine({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 3,
    viewport: [32, 32],
  }) as Engine
  try {
    await backend.prepare()
    // The GPU cut's readback lands one image later (#1483): the first asks for the leaves, which
    // enter the residency the image after their bytes; drawn and drained until they are drawn.
    await settledImage(backend)
    backend.dropPage('0')
    assert.deepEqual(backend.selectedPageIds().sort(), ['0', '1'])
    const cam = camera()
    cam.lookAt(0, 0, 10)
    // The drop waits out the window of the page the images stopped drawing, each read back.
    for (let i = 0; i <= LAST_USE_WINDOW; i++) await flushedImage(backend, cam)
    await flushedImage(backend)
    backend.render(camera())
    assert.deepEqual(backend.selectedPageIds(), ['2'])
    assert.deepEqual(backend.pendingUrls!(), ['0'])
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

test('a leaf carrying its own coarse representation keeps that GPU fallback during exact-page loading', async () => {
  installGpuGlobals()
  const fixture = coarseQuadScene(),
    { device } = mockGpu()
  // One cluster replaced by one coarser cluster: a group of a single child.
  const leaf = { ...fixture.metadata.primitives[0].pages[0], count: 6, bytes: 24 }
  const level = dagLevel([leaf], [{ ...fixture.metadata.primitives[0].pages[2], id: 1 }], 1)
  const metadata: ClusterManifest = {
    ...fixture.metadata,
    primitives: [{ ...fixture.metadata.primitives[0], ...level }],
  }
  const backend = webgpuPagesEngine({
    ...fixture,
    metadata,
    indices: new Map(),
    readPage: async () => fixture.indices.get('2')!,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  }) as Engine
  try {
    await backend.prepare()
    await flushedImage(backend)
    assert.deepEqual(backend.selectedPageIds(), ['2'])
    backend.acceptPage('0', fixture.indices.get('2')!)
    await settledImage(backend)
    assert.deepEqual(backend.selectedPageIds(), ['0'])
  } finally {
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

test('cancelling initial coverage loading cannot publish a ready backend', async () => {
  installGpuGlobals()
  const fixture = quadScene(),
    { device, draws } = mockGpu(),
    controller = new AbortController()
  let reading!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => {
      reading = resolve
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve
    })
  const backend = webgpuPagesEngine({
    ...fixture,
    indices: new Map(),
    readPage: async (url) => {
      reading()
      await gate
      return fixture.indices.get(url)!
    },
    signal: controller.signal,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  })
  try {
    const preparing = backend.prepare()
    await started
    controller.abort()
    release()
    await assert.rejects(preparing, { name: 'AbortError' })
    assert.equal(backend.metrics().coverageReady, false)
    assert.equal(draws.length, 0)
  } finally {
    release()
    backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})

test('moving opaque cameras use the current GPU selection without CPU reselection', async () => {
  installGpuGlobals()
  const fixture = quadScene()
  const collected = collectClusterPages(
    fixture.source,
    fixture.metadata,
    fixture.indices,
    fixture.associations,
  )
  const packed = packDagSelection(collected.roots)
  const { device, draws, buffers } = mockGpu({ packed })
  const events: Array<{ phase: string; context?: Record<string, unknown> }> = []
  const backend = webgpuPagesEngine({
    ...fixture,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
    onDiagnostic: (event) => events.push(event),
  }) as Engine
  try {
    await backend.prepare()
    const cam = camera()
    for (const target of [100, 0, 100, 0]) {
      cam.lookAt(target, 0, target ? 5 : 0)
      cam.updateMatrixWorld()
      draws.length = 0
      backend.render(cam)
      // Selection of the CURRENT IMAGE, read in its mask: that is what the indirect commands consume
      // as instances, without waiting for a past image's sample.
      assert.equal(drawnPageIds(buffers, packed.nodeCount, packed.pageCount).length, target ? 0 : 2)
      await backend.flush()
    }
    assert.equal(
      events.filter((event) => event.phase === 'cpu-selection').length,
      0,
      'GPU camera motion must not trigger a duplicate CPU cut',
    )
    assert.ok(events.some((event) => event.phase === 'gpu-selection-current-frame'))
  } finally {
    await backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})
