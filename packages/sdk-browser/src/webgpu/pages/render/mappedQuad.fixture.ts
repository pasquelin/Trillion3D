import type { Texture } from '../../../../../sdk-core/src/world/texture/texture.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { camera, quadScene } from '../testScenes.fixture.ts'
import { webgpuPagesEngine } from '../pages.ts'
import type { PageSurface } from '../../../page/surface.ts'
import { createTextureCaches } from '../../../texture/textureCaches.ts'
import { createPageCache } from '../../../streaming/pageCache.ts'

/** A pages backend on the mock device drawing the quad scene with `map` on its surface: prepared,
 *  one image drawn and flushed — the state a change made after it is measured from. */
export async function mappedQuadRun(map: Texture) {
  installGpuGlobals()
  const gpu = fakeDevice(BACKEND)
  map.needsUpdate = true
  const fixture = quadScene()
  const surface = fixture.material as PageSurface
  surface.map = map
  const backend = webgpuPagesEngine({
    textureCaches: createTextureCaches(createPageCache()),
    ...fixture,
    gpuDevice: gpu.device,
    maxResidentPages: 2,
    viewport: [32, 32],
  })
  await backend.prepare()
  const cam = camera()
  backend.render(cam)
  await backend.flush()
  return { gpu, fixture, surface, backend, cam }
}
