import { DEFERRED_BINDINGS } from '../lighting/deferred/bindings.ts'
import { surfacesOfRows } from '../page/rowSurfaces.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { loadOnlyTarget } from '../gpu/core/loadOnlyTarget.ts'
import type { VisMaterial } from '../visibility/materialType.ts'

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
/** Whether `surface` is a thin sheet that transmits: double-sided, its subsurface colour not black —
 *  what the thin transmission target is made for (`wantsSubsurface`). */
export const isSubsurfaceSheet = (surface: Pick<VisMaterial, 'side' | 'subsurfaceColor'>) =>
  surface.side === 'double' && !!surface.subsurfaceColor?.some((component) => component > 0)

/** Whether a row's surface is a thin sheet that transmits (`isSubsurfaceSheet`): the target is made. */
export function wantsSubsurface(rt: WebgpuPagesRuntime) {
  return surfacesOfRows(rt.layout.rows).some(isSubsurfaceSheet)
}
