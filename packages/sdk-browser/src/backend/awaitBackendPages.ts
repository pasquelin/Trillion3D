import type { HostCamera } from '../camera/world.ts';
import type { RenderBackend } from './types.ts';

type PageBackend = Pick<
  RenderBackend,
  'render' | 'pendingUrls' | 'pageUrls' | 'syncResident' | 'flush'
>;

/** Explicit loading/capture preparation, outside the measured render loop. `image: false` waits
 *  for the pages alone: no flush reads the image back. Once the cut is read, `load` hears the pages
 *  the view reads, split in two: those it lacks, to read, and those it already holds — which the
 *  frames drawn before the wait may have read, all of them. */
export async function awaitBackendPages(
  backend: PageBackend,
  camera: HostCamera,
  load: (missing: string[], held: string[]) => Promise<void>,
  options: { image?: boolean } = {},
) {
  backend.render(camera);
  // A GPU cut publishes streaming requests only after its asynchronous readback.
  await backend.flush?.(options);
  const missing = [...(backend.pendingUrls?.() ?? [])];
  const lacking = new Set(missing);
  const held = [...new Set(backend.pageUrls?.())].filter((url) => !lacking.has(url));
  await load(missing, held);
  if (backend.flush) {
    // First enqueue uploads for the resolved cut, then draw the resident result.
    // CPU bytes may already exist even though no GPU slot has been loaded yet.
    backend.render(camera);
    await backend.flush(options);
    backend.render(camera);
    await backend.flush(options);
  } else if (missing.length) {
    if (backend.syncResident) backend.syncResident();
    else backend.render(camera);
  }
}
