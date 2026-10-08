import type { HostCamera } from '../camera/world.ts'
import type { Engine } from './types.ts'

type PageEngine = Pick<Engine, 'render' | 'pendingUrls' | 'flush'>

/** Explicit loading/capture preparation, outside the measured render loop. `image: false` waits
 *  for the pages alone: no flush reads the image back. Once the cut is read, `load` hears the pages
 *  it lacks — none, when the frames drawn before the wait read them all —, before `pageUrls` moves. */
export async function awaitEnginePages(
  backend: PageEngine,
  camera: HostCamera,
  load: (missing: string[]) => Promise<void>,
  options: { image?: boolean } = {},
) {
  // The first image reads the cut: a GPU cut publishes its requests only after its readback. The
  // second enqueues the uploads of the pages loaded — CPU bytes may exist before any GPU slot —,
  // the third draws the resident result.
  for (let image = 0; image < 3; image++) {
    backend.render(camera)
    await backend.flush(options)
    if (image === 0) await load([...backend.pendingUrls()])
  }
}
