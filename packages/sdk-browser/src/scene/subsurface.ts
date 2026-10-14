import { DEFERRED_BINDINGS } from '../lighting/deferred/bindings.ts'
import { someRowSurface } from '../page/rowSurfaces.ts'
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
/** Whether `surface` is a thin sheet that transmits: its subsurface colour not black — the record
 *  keeps that colour on a lit double-sided surface alone (`sheet`, `../page/surfaceRecord.ts`) —,
 *  what the thin transmission target is made for (`wantsSubsurface`). */
export const isSubsurfaceSheet = (surface: Pick<VisMaterial, 'subsurfaceColor'>) =>
  !!surface.subsurfaceColor?.some((component) => component > 0)

const sheetRows = someRowSurface(isSubsurfaceSheet)

/** Whether a row's surface is a thin sheet that transmits (`isSubsurfaceSheet`): the target is made.
 *  O(1) while the rows and their materials hold (`someRowSurface`). */
export const wantsSubsurface = (rt: WebgpuPagesRuntime) => sheetRows(rt.layout.rows)
