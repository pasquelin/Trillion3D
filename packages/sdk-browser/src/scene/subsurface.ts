import { DEFERRED_BINDINGS } from '../lighting/deferred/bindings.ts'
import { surfacesOfRows } from '../page/rowSurfaces.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { loadOnlyTarget } from '../gpu/core/loadOnlyTarget.ts'

/** Independent diffuse transmission, disabled by black and restricted to thin double-sided matter. */
export const SUBSURFACE_FLAG = 32
/** The thin transmission colour's format, written by the shade pass and loaded by the lighting. */
export const SUBSURFACE_FORMAT: GPUTextureFormat = 'rgba16float'
/** The lighting's read of the thin transmission colour, by load alone; its bytes, one texel per
 *  pixel when wanted, a 1×1 placeholder otherwise (`bytes`). */
export const SUBSURFACE_TARGET = loadOnlyTarget(
  DEFERRED_BINDINGS.subsurface,
  SUBSURFACE_FORMAT,
  'subsurfaceColor',
)
export function wantsSubsurface(rt: WebgpuPagesRuntime) {
  return surfacesOfRows(rt.layout.rows).some(
    (surface) => surface.doubleSided && surface.subsurfaceColor?.some((component) => component > 0),
  )
}
