// A pose served as the pool can give it, under the GPU cut, the engine's one cut (#1483): the
// readback of an image is adopted by the drain after it; a page whose bytes landed enters the
// residency at the next image, which voids the readback in hand — its counts read null — and cuts
// again (`render/gpuCutStream.ts`). As `awaitEnginePages`, a test draws and drains until then.
import assert from 'node:assert/strict'
import type { Engine } from '../../engine/types.ts'
import { camera, flushedImage } from './testScenes.fixture.ts'

type Settling = Pick<Engine, 'render' | 'flush' | 'metrics'> & Partial<Pick<Engine, 'pendingUrls'>>

/**
 * Images drawn at `cam`, each drained then drawn again, until one counts its cut on the residency
 * in place and — `arrived`, the default — no page the cut asks is still on its way. It ends on a
 * drawn image: its lists and counts are the settled cut's. At most `images`.
 */
export async function settledImage(
  backend: Settling,
  cam = camera(),
  { arrived = true, images = 12 }: { arrived?: boolean; images?: number } = {},
) {
  for (let image = 0; image < images; image++) {
    await flushedImage(backend, cam)
    backend.render(cam)
    if (backend.metrics().submittedTriangles === null) continue
    if (!arrived || !backend.pendingUrls?.().length) return
  }
  assert.fail(`the pose did not settle in ${images} images`)
}
