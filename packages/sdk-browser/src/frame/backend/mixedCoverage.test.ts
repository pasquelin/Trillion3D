import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { webgpuPagesEngine } from './pages.ts'
import { collectClusterPages } from '../../geometry/selection/collect.ts'
import { packDagSelection } from '../../geometry/dag/pack/pack.ts'
import { installGpuGlobals, transparentDraws } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND, writtenBytes } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { quadScene, camera } from './testScenes.fixture.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'
import { createTextureCaches } from '../../materials/texture/textureCaches.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'
import type { PageMesh } from '../../geometry/pages/pageMesh.ts'

test('mixed GPU and transparent pages wait for initial coverage before validating the resident cut', async () => {
  installGpuGlobals()
  // A still clock, or a loaded machine lands the uploads a task later (`MAIN_THREAD_FRAME_MS`).
  mock.method(performance, 'now', () => 0)
  const fixture = quadScene(),
    blend = quadScene()
  const mesh = blend.source.children[0] as PageMesh
  fixture.source.add(mesh)
  blend.material.transparent = true
  G.sided(blend.material, G.DOUBLE_SIDE)
  blend.material.twoSidedPasses = true
  const primitive = blend.metadata.primitives[0]
  primitive.mesh = 1
  primitive.pass = 'clustered-blend'
  primitive.pages = primitive.pages.map((page) => ({ ...page, url: `blend-${page.url}` }))
  fixture.metadata.primitives.push(primitive)
  fixture.associations.set(mesh, { meshes: 1, primitives: 0 })
  for (const [url, array] of blend.indices) fixture.indices.set(`blend-${url}`, array)
  const collected = collectClusterPages(
    fixture.source,
    graphDraws(fixture.source, fixture.associations),
    fixture.metadata,
    fixture.indices,
  )
  // One catalogue for one cut: the kernel the mock replays selects the transparent clusters too,
  // opaque roots first then transparent, exactly as the layout packs them.
  const { device } = fakeDevice({
    ...BACKEND,
    packed: packDagSelection([
      ...collected.roots.filter((root) => !root.pages[0].transparent),
      ...collected.roots.filter((root) => root.pages[0].transparent),
    ]),
  })
  const backend = webgpuPagesEngine({
    textureCaches: createTextureCaches(createPageCache()),
    ...fixture,
    draws: graphDraws(fixture.source, fixture.associations),
    indices: new Map(),
    gpuDevice: device,
    maxResidentPages: 4,
    viewport: [32, 32],
  })
  try {
    await backend.prepare()
    assert.doesNotThrow(() => backend.render(camera()))
    assert.equal(backend.metrics().coverageReady, false)
    assert.deepEqual(backend.pendingUrls?.().sort(), ['0', '1', 'blend-0', 'blend-1'])
    for (const [url, array] of fixture.indices) backend.acceptPage(url, array)
    await backend.flush()
    backend.render(camera())
    await backend.flush()
    assert.equal(backend.metrics().coverageReady, true)
    // The interactive barrier adopts the complete GPU cut before the frame that measures it. A
    // plain image flush only settles the work submitted by the preceding render.
    assert.equal(await backend.pendingFrame(), true)
    backend.render(camera())
    assert.equal(backend.metrics().transparentSubmittedTriangles, 2)
    assert.equal(backend.metrics().submittedTriangles, 4)
  } finally {
    mock.restoreAll()
    await backend.dispose()
    fixture.geometry.dispose()
    fixture.material.dispose()
    blend.geometry.dispose()
    blend.material.dispose()
  }
})

test('cached clustered cuts keep visibility current and leave unchanged mesh indices uploaded', async () => {
  installGpuGlobals()
  const fixture = quadScene(),
    other = quadScene(),
    legacy = quadScene(),
    { device, writes, draws } = fakeDevice(BACKEND)
  fixture.material.transparent = true
  G.sided(fixture.material, G.DOUBLE_SIDE)
  fixture.material.twoSidedPasses = true
  fixture.metadata.primitives[0].pass = 'clustered-blend'
  const mesh = fixture.source.children[0] as PageMesh,
    legacyMesh = legacy.source.children[0] as PageMesh
  legacy.material.transparent = true
  G.sided(legacy.material, G.DOUBLE_SIDE)
  legacy.material.twoSidedPasses = true
  legacy.metadata.primitives[0].mesh = 1
  legacy.metadata.primitives[0].pass = 'clustered-blend'
  fixture.source.add(legacyMesh)
  fixture.metadata.primitives.push(legacy.metadata.primitives[0])
  fixture.associations.set(legacyMesh, { meshes: 1, primitives: 0 })
  const otherMesh = other.source.children[0] as PageMesh
  other.material.transparent = true
  G.sided(other.material, G.DOUBLE_SIDE)
  other.material.twoSidedPasses = true
  const otherPrimitive = other.metadata.primitives[0]
  otherPrimitive.mesh = 2
  otherPrimitive.pass = 'clustered-blend'
  otherPrimitive.pages = otherPrimitive.pages.map((page) => ({
    ...page,
    url: `other-${page.url}`,
  }))
  fixture.source.add(otherMesh)
  fixture.metadata.primitives.push(otherPrimitive)
  fixture.associations.set(otherMesh, { meshes: 2, primitives: 0 })
  for (const [url, array] of other.indices) fixture.indices.set(`other-${url}`, array)
  const backend = webgpuPagesEngine({
    textureCaches: createTextureCaches(createPageCache()),
    ...fixture,
    draws: graphDraws(fixture.source, fixture.associations),
    gpuDevice: device,
    maxResidentPages: 6,
    viewport: [32, 32],
  })
  // Triangles the image drew: the instance count the cut writes falls to zero, the encode plan
  // never moves. A double-sided item draws its triangles twice, once per face pass.
  const dessines = () =>
    transparentDraws(draws.splice(0, draws.length)).reduce(
      (sum, draw) => sum + (draw.vertexCount * (draw.instanceCount ?? 0)) / 3,
      0,
    )
  const cam = camera()
  /** One pose under the GPU cut (#1483): drawn and flushed — its readback, cut under the poses in
   *  place, adopted —, then drawn again, the draws of that image alone counted. */
  const image = async () => {
    backend.render(cam)
    await backend.flush()
    draws.length = 0
    backend.render(cam)
  }
  try {
    await backend.prepare()
    await image()
    // Three paged meshes of two triangles, once each.
    assert.equal(backend.metrics().transparentSubmittedTriangles, 6)
    assert.equal(dessines(), 12, 'three meshes, two faces each')
    const uploads = writes.length
    otherMesh.position.x = 100
    await image()
    assert.equal(
      backend.metrics().transparentSubmittedTriangles,
      4,
      'another paged mesh can disappear without changing this mesh cut',
    )
    assert.equal(dessines(), 8)
    legacyMesh.position.x = 100
    await image()
    assert.equal(backend.metrics().transparentSubmittedTriangles, 2)
    assert.equal(dessines(), 4, 'a third leaves while the first cut stays unchanged')
    mesh.position.x = 100
    await image()
    assert.equal(backend.metrics().transparentSubmittedTriangles, 0)
    assert.equal(dessines(), 0)
    mesh.position.x = 0
    await image()
    assert.equal(
      backend.metrics().transparentSubmittedTriangles,
      2,
      'cached pages become visible again',
    )
    assert.equal(dessines(), 4)
    legacyMesh.position.x = 0
    await image()
    assert.equal(backend.metrics().transparentSubmittedTriangles, 4)
    assert.equal(dessines(), 8)
    otherMesh.position.x = 0
    await image()
    assert.equal(backend.metrics().transparentSubmittedTriangles, 6)
    assert.equal(dessines(), 12)
    // Read by content, not by size: the GPU cut, which draws every image (#1483), writes other
    // 24-byte words when a placement moves, none of them an index.
    const meshIndices = Uint32Array.from(legacy.geometry.index!.array),
      indexData = [...fixture.indices.values(), meshIndices]
    const reuploads = writes
      .slice(uploads)
      .map(writtenBytes)
      .filter((bytes) =>
        indexData.some(
          (data) =>
            data.byteLength === bytes.byteLength &&
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength).every(
              (byte, k) => byte === bytes[k],
            ),
        ),
      )
    assert.equal(reuploads.length, 0, 'existing index buffers survive visibility changes')
  } finally {
    await backend.dispose()
    for (const scene of [fixture, other, legacy]) {
      scene.geometry.dispose()
      scene.material.dispose()
    }
  }
})
