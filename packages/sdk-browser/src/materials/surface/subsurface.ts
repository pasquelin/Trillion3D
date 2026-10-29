import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { DEFERRED_BINDINGS } from '../../lighting/deferred/bindings.ts'
import { someRowSurface } from '../../geometry/pages/rowSurfaces.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { loadOnlyTarget } from '../../gpu/core/loadOnlyTarget.ts'
import type { VisMaterial } from '../../visibility/materialType.ts'
import { SURFACE_COLOURS_FORMAT } from './surfaceOutputs.ts'
import { holdsPixelModels, isPixelModel, pixelModelOf } from './pixelModel.ts'

/** Independent diffuse transmission, disabled by black and restricted to thin double-sided matter. */
export const SUBSURFACE_FLAG = 32
/** Whether a pixel of surface flags `flags` is of a subsurface model: a thin transmitting sheet
 *  (`SUBSURFACE_FLAG`) or a pixel of one of the shading models it carries (`PIXEL_MODEL`: subsurface,
 *  preintegrated skin, subsurface profile, hair, eye). The one rule the shadows share: the virtual maps
 *  cull no back face of such a pixel. */
export const isSubsurfaceModel = wgslFn(
  'isSubsurfaceModel',
  [pixelModelOf, isPixelModel],
  `fn isSubsurfaceModel(flags:u32)->bool{
 return (flags&${SUBSURFACE_FLAG}u)!=0u||isPixelModel(pixelModelOf(flags));
}`,
)
/** The thin transmission colour's format, written by the shade pass and loaded by the lighting: a
 *  layer of the surfaces' colours (`SurfaceBuffer.colours`). */
export const SUBSURFACE_FORMAT: GPUTextureFormat = SURFACE_COLOURS_FORMAT
/** The lighting's read of the thin transmission colour, by load alone; its bytes, one texel per
 *  pixel when wanted, a 1×1 placeholder otherwise (`bytes`). */
export const SUBSURFACE_TARGET = loadOnlyTarget(
  DEFERRED_BINDINGS.subsurface,
  SUBSURFACE_FORMAT,
  'subsurfaceColor',
)
/** Whether `surface` is a thin sheet that transmits: its subsurface colour not black — the record
 *  keeps that colour on a lit double-sided surface alone (`sheet`, `../../geometry/pages/surfaceRecord.ts`) —,
 *  what the thin transmission target is made for (`wantsSubsurface`). */
const isSubsurfaceSheet = (surface: Pick<VisMaterial, 'subsurfaceColor'>) =>
  !!surface.subsurfaceColor?.some((component) => component > 0)

/** Whether the target holds something of `surface`: its thin transmission (`isSubsurfaceSheet`), or what a
 *  shading model its graph may pick per pixel needs (`holdsPixelModels`). */
export const writesSubsurfaceTarget = (
  surface: Pick<VisMaterial, 'subsurfaceColor' | 'graph' | 'shadingModel' | 'modelFromGraph'>,
) => isSubsurfaceSheet(surface) || holdsPixelModels(surface)

const sheetRows = someRowSurface(writesSubsurfaceTarget)

/** Whether a resident cluster's surface writes the thin transmission's target (`writesSubsurfaceTarget`):
 *  the target is made. O(1) while the clusters and their materials hold (`someRowSurface`). */
export const wantsSubsurface = (rt: WebgpuPagesRuntime) => sheetRows(rt.layout.clusters)

const modelRows = someRowSurface(holdsPixelModels)

/** Whether a resident cluster's surface may give its pixels a shading model of a graph's choice
 *  (`holdsPixelModels`): the data those models read is made ready. */
export const wantsPixelModels = (rt: WebgpuPagesRuntime) => modelRows(rt.layout.clusters)
