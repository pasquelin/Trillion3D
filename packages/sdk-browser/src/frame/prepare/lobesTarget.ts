import { someRowSurface } from '../../geometry/pages/rowSurfaces.ts'
import { hasPhysicalLobes } from '../../materials/surface/physicalLobes.ts'
import { holds } from '../../materials/surface/surfaceBuffer.ts'
import { withLobes } from '../../materials/surface/surfaceAllocation.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { swapSurfaces } from '../backend/state/gpu.ts'

const lobedRows = someRowSurface(hasPhysicalLobes)

/** Whether a row of the image wears a surface with an anisotropic or clear-coat lobe
 *  (`../../materials/surface/physicalLobes.ts`): the opaque resolve lights through them. O(1) while the
 *  rows and their materials hold (`someRowSurface`). */
export const rowsWearLobes = (rt: WebgpuPagesRuntime) => lobedRows(rt.layout.rows)

/** Whether the lobes target is full-size: a row wears a lobed surface. */
export const wantsPhysicalLobes = (rt: WebgpuPagesRuntime) => rowsWearLobes(rt)

/** Whether the lobes target of the drawn view holds every pixel. */
export const lobesHeld = ({ gpu: { surfaces } }: WebgpuPagesRuntime) =>
  !!surfaces && holds(surfaces, surfaces.lobes)

/**
 * At every image's start, its rows written, before anything names the target (`encodeVis`): the
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
