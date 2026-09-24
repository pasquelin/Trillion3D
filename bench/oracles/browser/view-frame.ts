// Batch F oracles, frame side: `packages/sdk-browser/src/webgpu/pages/render/encodeVis.ts:93-98`, `packages/sdk-browser/src/backend/autonomous/instances.ts:76-86`,
// and `packages/sdk-browser/src/world/render/draw.ts:72-74` from before batch F, copied as-is.
import type { Matrix4 } from '../../../packages/sdk-core/src/world/math/matrix4.ts';
import type { SurfaceBuffer } from '../../../packages/sdk-browser/src/scene/surfaceBuffer.ts';
import { createPageStreamer } from '../../../packages/sdk-browser/src/streaming/pages.ts';

/** A page or root as the instance oracle mutates it: only `matrix`/`mesh`/`world` are read or
 *  written, never the rest of `PageRec`/`ClusterRoot`. */
interface InstancePage {
  matrix: Matrix4;
  mesh?: { matrix: Matrix4 };
}
interface InstanceRoot {
  world: Matrix4;
}

/** Colour attachments, rebuilt per frame before batch F. */
export function referenceAttachments(surfaces: SurfaceBuffer) {
  return surfaces.views().map((view) => ({
    view,
    loadOp: 'clear' as const,
    storeOp: 'store' as const,
    clearValue: [0, 0, 0, 0],
  }));
}

/** Instance displacement before batch F: one hash table per call. */
export function referenceUpdateInstance(
  instance: { pages: InstancePage[]; roots: InstanceRoot[] },
  basePages: InstancePage[],
  baseRoots: InstanceRoot[],
  transform: Matrix4,
) {
  const mapped = new Map(basePages.map((base, i) => [instance.pages[i], base]));
  for (let i = 0; i < instance.roots.length; i++)
    instance.roots[i].world.copy(transform).multiply(baseRoots[i].world);
  for (const rec of instance.pages) {
    const base = mapped.get(rec);
    if (!base) continue;
    rec.matrix.copy(transform).multiply(base.matrix);
    if (rec.mesh) rec.mesh.matrix.copy(rec.matrix);
  }
}

/** The cold ring before batch F: the whole ring filtered, then its head kept. */
export function referenceAnneauFroid(
  ring: readonly string[],
  streamer: Pick<ReturnType<typeof createPageStreamer>, 'has' | 'loading' | 'failed'>,
  limite: number,
) {
  return ring
    .filter((url) => !streamer.has(url) && !streamer.loading(url) && !streamer.failed(url))
    .slice(0, limite);
}
