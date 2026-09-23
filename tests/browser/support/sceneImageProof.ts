// Reading a rendered frame back: pixels, the frame-held wait, and the pixel comparisons the
// browser proofs share. Split from `sharedSceneProof.ts` (scene construction and mounting)
// to keep each file under the line gate.
import type * as THREE from 'three';
import type { RenderBackend } from '../../../packages/sdk-browser/src/backend/types.ts';

/** `RenderBackend` does not declare `cpuFrameEnd` publicly; the object `webgpuPagesBackend`
 *  returns still carries it (`packages/sdk-browser/src/webgpu/pages/pages.ts`). Read here through a local
 *  extension of the public type rather than widening it in the engine. */
interface BackendAvecCpuFrameEnd extends RenderBackend {
  cpuFrameEnd?(): void;
}

/** Renders a frame and rereads its pixels and public counters. The frame bound is closed as
 *  a host does: that is what publishes the per-stage counters. */
export async function image(
  backend: RenderBackend,
  camera: THREE.PerspectiveCamera,
): Promise<{ pixels: Uint8Array; metriques: ReturnType<RenderBackend['metrics']> }> {
  backend.render(camera);
  (backend as BackendAvecCpuFrameEnd).cpuFrameEnd?.();
  await backend.flush!();
  return { pixels: backend.capture!(), metriques: backend.metrics() };
}

/** Maximum images rendered before giving up waiting for frame hold. */
export const PLAFOND = 64;

/** Renders until the image is held; returns the last RENDERED image, the held one, and the count. */
export async function jusquaTenue(
  backend: RenderBackend,
  camera: THREE.PerspectiveCamera,
): Promise<{ rendue: number[] | undefined; tenue: number[] | null; rendues: number }> {
  let rendue: number[] | undefined,
    rendues = 0;
  for (let i = 0; i < PLAFOND; i++) {
    const { pixels, metriques } = await image(backend, camera);
    if (metriques.frameHeld) return { rendue, tenue: Array.from(pixels), rendues };
    rendue = Array.from(pixels);
    rendues++;
  }
  return { rendue, tenue: null, rendues };
}

/** How many RGBA quadruplets differ between two images of the same size. */
export function difference(a: Uint8Array | number[], b: Uint8Array | number[]): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 4)
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3])
      n++;
  return n;
}

/** True when the pixel at `i` carries the tile's red and not the background's blue. */
export const estRouge = (pixels: Uint8Array | number[], i: number): boolean =>
  pixels[i] > 110 && pixels[i] > pixels[i + 2] + 40;

/** The number of pixels that carry the tile's red rather than the background's blue. */
export function redCount(pixels: Uint8Array | number[]): number {
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4) if (estRouge(pixels, i)) n++;
  return n;
}
