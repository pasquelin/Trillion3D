// A capture's pages that only the host can give — started, their bytes not in, no read serving
// them — are asked of the host's reader, not waited on by drawing again (`fetchHostPages`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { camera, disposeQuadRun } from '../backend/testScenes.fixture.ts'
import { coarseQuadScene } from '../backend/coarseQuads.fixture.ts'
import { webgpuPagesEngine } from '../backend/pages.ts'
import { createTextureCaches } from '../../materials/texture/textureCaches.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'

/** The coarse quad whose pages are in no memory: its cover page is the one the host's reader gives
 *  at prepare; the two detail pages are asked of it, when `readPage` is, only by a capture. */
function hostedQuad() {
  installGpuGlobals()
  const { device } = fakeDevice(BACKEND)
  const scene = coarseQuadScene()
  const asked: string[] = []
  const backend = webgpuPagesEngine({
    textureCaches: createTextureCaches(createPageCache()),
    ...scene,
    indices: new Map(),
    readPage: async (url) => {
      asked.push(url)
      return scene.indices.get(url)!
    },
    gpuDevice: device,
    maxResidentPages: 3,
    viewport: [32, 32],
  })
  return { backend, asked, scene }
}

test('a surface capture asks the host for the pages the streaming waits on', async () => {
  const { backend, asked, scene } = hostedQuad()
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    const surface = await backend.captureSurfaceView!(camera(), { width: 16, height: 16 })
    assert.ok(asked.includes('0') && asked.includes('1'), `asked ${asked.join(',')}`)
    surface.dispose()
  } finally {
    disposeQuadRun(backend, scene)
  }
})

test('a colour capture asks the host for them too, and draws once they are in', async () => {
  const { backend, asked, scene } = hostedQuad()
  try {
    await backend.prepare()
    backend.render(camera())
    await backend.flush()
    const image = await backend.captureColorView!(camera(), { width: 16, height: 16 })
    assert.equal(image.length, 16 * 16 * 4)
    assert.ok(asked.includes('0') && asked.includes('1'), `asked ${asked.join(',')}`)
  } finally {
    disposeQuadRun(backend, scene)
  }
})
