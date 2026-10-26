import { someRowSurface } from '../../geometry/pages/rowSurfaces.ts'
import { hasLightingLobes } from '../../materials/surface/physicalLobes.ts'
import { readShading, shadingMoved } from '../../materials/surface/pixelModel.ts'
import { holds } from '../../materials/surface/surfaceBuffer.ts'
import { withLobes } from '../../materials/surface/surfaceAllocation.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { swapSurfaces } from '../backend/state/gpu.ts'

const lobedRows = someRowSurface(hasLightingLobes)

/** Whether a cluster of the image wears a surface whose lighting may need a lobe — an anisotropic one, a
 *  clear coat, a cloth (`../../materials/surface/physicalLobes.ts`): the opaque lit passes light through
 *  them. O(1) while the clusters and their materials hold (`someRowSurface`). */
export const rowsWearLobes = (rt: WebgpuPagesRuntime) => lobedRows(rt.layout.clusters)

/** Whether the lobes target is full-size: a cluster wears a lobed surface. */
export const wantsPhysicalLobes = (rt: WebgpuPagesRuntime) => rowsWearLobes(rt)

/** Whether the lobes target of the drawn view holds every pixel. */
export const lobesHeld = ({ gpu: { surfaces } }: WebgpuPagesRuntime) =>
  !!surfaces && holds(surfaces, surfaces.lobes)

/**
 * At every image's start, its clusters' records written, before anything names the target (`encodeVis`): the
 * lobes target is full-size while a surface wants it, a 1×1 otherwise (`wantsPhysicalLobes`),
 * remade alone when that flips (`withLobes`) — the frame's other targets stay. The target replaced
 * is retired, destroyed after the frame's submit (`frameRetire.ts`): this image names the new one
 * throughout.
 */
export function followLobes(rt: WebgpuPagesRuntime) {
  const { gpu } = rt,
    surfaces = gpu.surfaces
  if (!surfaces || !gpu.device) return
  const wanted = wantsPhysicalLobes(rt)
  if (holds(surfaces, surfaces.lobes, wanted)) return
  swapSurfaces(gpu, surfaces, withLobes(gpu.device, surfaces, wanted))
  retire(gpu.device, surfaces.lobes)
}

/**
 * At every image's start, before the hold: the shading settings are read once for the image (`readShading`), and the
 * models' switches (`irisNormal`, `clearCoatNormal`) and the normal curvature's curve are the
 * ones the last drawn image was shaded with, or the scene moves in place as a material written does
 * (`gate.movedInPlace`): the image of every surface that wears an eye or a clear coat changes, so the
 * frame is no longer held. Nothing before the first image.
 */
export function followModelSwitches(rt: WebgpuPagesRuntime) {
  const { shading, shadingDrawn } = rt.run
  readShading(rt, shading)
  if (shadingDrawn !== undefined && shadingMoved(shadingDrawn, shading)) rt.run.gate.movedInPlace()
}
