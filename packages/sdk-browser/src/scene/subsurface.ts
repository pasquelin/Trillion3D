import { surfacesOfRows } from '../page/rowSurfaces.ts';
import { refreshSurface } from '../page/surface.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';

/** Independent diffuse transmission, disabled by black and restricted to thin double-sided matter. */
export const SUBSURFACE_FLAG = 32;
export const SUBSURFACE_BINDING = 22;
export const SUBSURFACE_BYTES = 8;
export function wantsSubsurface(rt: WebgpuPagesRuntime) {
  return surfacesOfRows(rt.layout.rows).some((surface) => {
    const material = refreshSurface(surface);
    return material.doubleSided && material.subsurfaceColor?.some((component) => component > 0);
  });
}
