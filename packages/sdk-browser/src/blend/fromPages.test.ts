// A transparent item reads every attribute from its quantized geometry pages, as the opaque rows
// do, never from host buffers built out of `source.bin` — a transmissive surface too.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { installGpuGlobals } from '../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { pagedQuad, FIRST, SECOND, type PagedQuad } from '../frame/backend/pagedQuad.fixture.ts'
import { createWebgpuPagesRuntime } from '../frame/backend/runtime.ts'
import { disposeWebgpuPages } from '../frame/io/metrics.ts'
import { prepareWebgpuPages } from '../frame/prepare/preparePages.ts'
import type { PageSurface } from '../geometry/pages/surface.ts'
import { createTextureCaches } from '../materials/texture/textureCaches.ts'
import { createPageCache } from '../geometry/streaming/pageCache.ts'

/** The quad of two quantized clusters, drawn as `pass` says under `surface`, prepared on the mock
 *  device with its page reader. */
async function preparedQuad(pass: string, surface: PageSurface) {
  installGpuGlobals()
  const fixture = pagedQuad([{ corners: FIRST }, { corners: SECOND }])
  fixture.metadata.primitives[0].pass = pass as never
  const [mesh] = fixture.associations.keys()
  mesh.material = surface
  mesh.geometry.setAttribute('normal', G.floatAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  mesh.geometry.setAttribute('uv', G.floatAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
  mesh.geometry.setAttribute('tangent', G.floatAttribute(new Array(16).fill(1), 4))
  const mock = fakeDevice(BACKEND)
  const rt = createWebgpuPagesRuntime({
    textureCaches: createTextureCaches(createPageCache()),
    ...fixture,
    gpuDevice: mock.device,
    maxResidentPages: 4,
    viewport: [32, 32],
    readGeometryPage: async (url: string) => fixture.bytes.get(url)!,
  } as never)
  await prepareWebgpuPages(rt, mock.device)
  return { rt, fixture, mesh }
}

const release = async (rt: Awaited<ReturnType<typeof preparedQuad>>['rt'], fixture: PagedQuad) => {
  await disposeWebgpuPages(rt)
  fixture.geometry.dispose()
}

test('a paged transparent item owns no host buffer and draws each cluster from its page', async () => {
  const cases: [string, PageSurface][] = [
    ['clustered-blend', G.basicSurface({ transparent: true, opacity: 0.5 })],
    ['exact-clusters', G.physicalSurface({ transmission: 1 })],
    // A compiled transmission: the compiler pages it as any blend.
    ['clustered-blend', G.physicalSurface({ transmission: 1 })],
  ]
  for (const [pass, surface] of cases) await pagedItem(pass, surface)
})

async function pagedItem(pass: string, surface: PageSurface) {
  const { rt, fixture, mesh } = await preparedQuad(pass, surface)
  try {
    const [item] = rt.blendState.blendGpu
    assert.equal(item.geometry.quantized, true, `${pass}: the shader decodes its pages`)
    assert.equal(item.geometry.hasTangent, false, 'a page stores no tangent')
    assert.equal(rt.vis.geometryBlocks.has(mesh.geometry.attributes), false, 'no float geometry')
    // Once resident, each cluster's span is its slot and the corners its page declares.
    rt.services.syncClusters()
    const { spans, entryOf } = rt.blendState.table!
    fixture.encoded.forEach((page, id) => {
      const entry = entryOf(id)
      assert.equal(spans[entry * 4 + 1], page.indexCount)
      assert.equal(spans[entry * 4], rt.gpu.cache!.get(`g${id}`)!.offset / 4)
    })
  } finally {
    await release(rt, fixture)
  }
}
