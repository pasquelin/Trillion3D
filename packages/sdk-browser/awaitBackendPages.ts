import type { HostCamera } from './cameraWorld.ts';
import type { RenderBackend } from './backendTypes.ts';

type PageBackend = Pick<RenderBackend, 'render' | 'pendingUrls' | 'syncResident' | 'flush'>;

/** Explicit loading/capture preparation, outside the measured render loop. */
export async function awaitBackendPages(
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
