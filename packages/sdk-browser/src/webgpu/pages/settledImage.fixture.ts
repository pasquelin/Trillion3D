// A pose served as the pool can give it, under the GPU cut, the engine's one cut (#1483): the
// readback of an image is adopted by the drain after it; the pages it asks whose bytes the session
// holds are queued by the image after that drain and land in the next one (`awaitEnginePages`); a
// page that landed enters the residency at the next image, which voids the readback in hand — its
// counts read null — and cuts again (`render/gpuCutStream.ts`). A test draws and drains till then.
import assert from 'node:assert/strict'
import type { Engine } from '../../engine/types.ts'
import { camera, flushedImage } from './testScenes.fixture.ts'

type Settling = Pick<
  Engine,
  'render' | 'flush' | 'metrics' | 'pendingUrls' | 'pageUrls' | 'landings'
>

/** What an image leaves the host: the pages it pins — the cut it asks and what it draws — and
 *  the pages landed so far. */
const hostState = (backend: Settling) =>
  `${[...backend.pageUrls()].sort().join()}|${backend.landings()}`

/**
 * Images drawn at `cam`, each drained then drawn again, until one counts its cut on the residency
 * in place and — `arrived`, the default — the pose is served: nothing for the host to fetch
 * (`pendingUrls`, the pages the session holds no bytes of), and since the image before, no page
 * landed and the pinned pages did not move. A page the cut asks whose bytes the session already
 * holds is never pending for the host: the engine queues its upload itself at the image after
 * the adoption, and it lands in the next drain — a landing, or a cut that moved, is that image
 * still on its way. It ends on a drawn image: its lists and counts are the settled cut's. At most
 * `images`.
 */
export async function settledImage(
  backend: Settling,
  cam = camera(),
  { arrived = true, images = 12 }: { arrived?: boolean; images?: number } = {},
) {
  let before: string | undefined
  for (let image = 0; image < images; image++) {
    await flushedImage(backend, cam)
    backend.render(cam)
    const state = arrived ? hostState(backend) : undefined,
      still = state === before
    before = state
    if (backend.metrics().submittedTriangles === null) continue
    if (!arrived || (still && !backend.pendingUrls().length)) return
  }
  assert.fail(`the pose did not settle in ${images} images`)
}
