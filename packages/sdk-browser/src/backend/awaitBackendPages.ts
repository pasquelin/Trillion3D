import type { HostCamera } from '../camera/world.ts';
import type { RenderBackend } from './types.ts';

type PageBackend = Pick<RenderBackend, 'render' | 'pendingUrls' | 'syncResident' | 'flush'> & {
  /** The cut's budget search has a finer threshold left to try (the WebGL2 engine's pool). */
  cutSettling?(): boolean;
};

/** Images a budget search may take to settle before the wait gives up: it steps by √2 from at
 *  most the root cover's threshold, so settling takes a logarithmic number of images. */
const MAX_SETTLE_ROUNDS = 64;

/** One image: the cut, the pages it asks for, then the resident result drawn. */
async function loadCut(
  backend: PageBackend,
  camera: HostCamera,
  load: (urls: string[]) => Promise<void>,
) {
  backend.render(camera);
  // A GPU cut publishes streaming requests only after its asynchronous readback.
  await backend.flush?.();
  const missing = [...(backend.pendingUrls?.() ?? [])];
  if (missing.length) await load(missing);
  if (backend.flush) {
    // First enqueue uploads for the resolved cut, then draw the resident result.
    // CPU bytes may already exist even though no GPU slot has been loaded yet.
    backend.render(camera);
    await backend.flush();
    backend.render(camera);
    await backend.flush();
  } else if (missing.length) {
    if (backend.syncResident) backend.syncResident();
    else backend.render(camera);
  }
}

/** Explicit loading/capture preparation, outside the measured render loop. A backend whose cut
 *  searches a budget threshold (`cutSettling`) is awaited until the search is settled and the
 *  pages of the settled cut are resident. */
export async function awaitBackendPages(
  backend: PageBackend,
  camera: HostCamera,
  load: (urls: string[]) => Promise<void>,
) {
  await loadCut(backend, camera, load);
  if (!backend.cutSettling) return;
  for (
    let round = 0;
    round < MAX_SETTLE_ROUNDS && (backend.cutSettling() || backend.pendingUrls?.().length);
    round++
  )
    await loadCut(backend, camera, load);
}
