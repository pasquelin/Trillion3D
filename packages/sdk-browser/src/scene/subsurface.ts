import { surfacesOfRows } from '../page/rowSurfaces.ts'
import { refreshSurface } from '../page/surface.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { loadOnlyTarget } from '../gpu/core/loadOnlyTarget.ts'

/** Independent diffuse transmission, disabled by black and restricted to thin double-sided matter. */
export const SUBSURFACE_FLAG = 32
export const SUBSURFACE_BINDING = 22
/** The lighting's read of the thin transmission colour, by load alone; its bytes, one texel per
 *  pixel when wanted, a 1×1 placeholder otherwise (`bytes`). */
export const SUBSURFACE_TARGET = loadOnlyTarget(
  SUBSURFACE_BINDING,
  'rgba16float',
  'subsurfaceColor',
)
export function wantsSubsurface(rt: WebgpuPagesRuntime) {
  return surfacesOfRows(rt.layout.rows).some((surface) => {
    const material = refreshSurface(surface)
    return material.doubleSided && material.subsurfaceColor?.some((component) => component > 0)
  })
}
