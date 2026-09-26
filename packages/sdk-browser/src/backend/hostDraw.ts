import type { Blending } from '../../../sdk-core/src/world/constants/index.ts';
import type { HostDrawCamera } from '../camera/world.ts';
import type { HostDrawOutput } from '../webgl/core/renderTarget.ts';

/** What an engine that draws on the host surface lets the host composer ask of its image. */
export interface BackendHostDraw {
  /** Draws the engine's whole image — paged clusters, diagnostic pages, scene copies, or the
   *  scene a witness holds — into the framebuffer the host has bound and cleared, `output`
   *  naming it and its display chain. Absent from an engine that presents its own surface. */
  drawHostGeometry?(camera: HostDrawCamera, output: HostDrawOutput): void;
  /** The blending of a surface the next `drawHostGeometry` draws that the effect chain's linear
   *  output cannot hold (`../webgl/cluster/linearRefusal.ts`), or `undefined`: read by the
   *  composer before it binds that output, from the draw's own walk of its graph. Absent from an
   *  engine whose draw has no such surface. */
  linearRefusal?(): Blending | undefined;
}
