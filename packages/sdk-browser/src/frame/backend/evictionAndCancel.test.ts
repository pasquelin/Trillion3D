import test from 'node:test'
import assert from 'node:assert/strict'
import { collectClusterPages } from '../../geometry/selection/collect.ts'
import { packDagSelection } from '../../geometry/dag/pack/pack.ts'
import { drawnPageIds, installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { dagLevel } from '../../session/engine/pagesEngine.fixture.ts'
import { backendOf, quadScene, camera, flushedImage } from './testScenes.fixture.ts'
import { coarseQuadScene, deepCoarseQuadsEngine } from './coarseQuads.fixture.ts'
import { settledImage } from './settledImage.fixture.ts'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import type { Engine } from '../../session/engine/types.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'

test('a host drop deferred for coverage is applied once the pool gives the page its slot to another', async () => {
  installGpuGlobals()
  const { device } = fakeDevice(BACKEND)
  const { fixture, backend } = deepCoarseQuadsEngine(device)
  const cam = camera()
  const settle = async (x: number) => {
    cam.position.set(x, 0, 5)
    cam.lookAt(x, 0, 0)
    cam.updateMatrixWorld()
    for (let image = 0; image < 6; image++) await settledImage(backend, cam, { arrived: false })
    return backend.selectedPageIds().sort()
  }
  try {
    await backend.prepare()
    assert.deepEqual(await settle(0), ['0', '1'])
    // The pool holds the page and the view draws it: the drop waits, no hole opens.
    backend.dropPage('0')
    assert.deepEqual(await settle(0), ['0', '1'])
    assert.deepEqual(backend.pendingUrls!(), [])
    // The other quad's arrivals take the slots of the leaves: the pool gave the page up, the drop
    // is applied, and the view back asks it again, the coarse page drawn meanwhile.
    assert.deepEqual(await settle(100), ['b0', 'b1'])
    assert.ok(backend.metrics().cacheEvictions! > 0)
    assert.deepEqual(await settle(0), ['2'])
    assert.deepEqual(backend.pendingUrls!(), ['0'])
  } finally {
    backend.dispose()
    fixture.dispose()
  }
})

test('a leaf carrying its own coarse representation keeps that GPU fallback during exact-page loading', async () => {
  installGpuGlobals()
  const fixture = coarseQuadScene(),
    { device } = fakeDevice(BACKEND)
  // One cluster replaced by one coarser cluster: a group of a single child.
  const leaf = { ...fixture.metadata.primitives[0].pages[0], count: 6, bytes: 24 }
  const level = dagLevel([leaf], [{ ...fixture.metadata.primitives[0].pages[2], id: 1 }], 1)
  const metadata: ClusterManifest = {
    ...fixture.metadata,
    primitives: [{ ...fixture.metadata.primitives[0], ...level }],
  }
  const backend = backendOf({
    ...fixture,
    metadata,
    indices: new Map(),
    readPage: async () => fixture.indices.get('2')!,
    gpuDevice: device,
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
    { device, draws } = fakeDevice(BACKEND),
    controller = new AbortController()
  let reading!: () => void, release!: () => void
  const started = new Promise<void>((resolve) => {
      reading = resolve
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve
    })
  const backend = backendOf({
    ...fixture,
    indices: new Map(),
    readPage: async (url) => {
      reading()
      await gate
      return fixture.indices.get(url)!
    },
    signal: controller.signal,
    gpuDevice: device,
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
    graphDraws(fixture.source, fixture.associations),
    fixture.metadata,
    fixture.indices,
  )
  const packed = packDagSelection(collected.roots)
  const { device, draws, buffers } = fakeDevice({ ...BACKEND, packed })
  const events: Array<{ phase: string; context?: Record<string, unknown> }> = []
  const backend = backendOf({
    ...fixture,
    gpuDevice: device,
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
      assert.equal(drawnPageIds(buffers).length, target ? 0 : 2)
      await backend.flush()
    }
    assert.ok(events.some((event) => event.phase === 'gpu-selection-current-frame'))
  } finally {
    await backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
  }
})
