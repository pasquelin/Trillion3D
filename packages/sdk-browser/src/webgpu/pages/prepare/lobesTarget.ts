import { someRowSurface } from '../../../page/rowSurfaces.ts'
import { hasPhysicalLobes } from '../../../scene/physicalLobes.ts'
import { holds } from '../../../scene/surfaceBuffer.ts'
import { withLobes } from '../../../scene/surfaceAllocation.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

const lobedRows = someRowSurface(hasPhysicalLobes)

/** Whether a row of the image wears a surface with an anisotropic or clear-coat lobe
 *  (`../../../scene/physicalLobes.ts`): the opaque resolve lights through them. O(1) while the
 *  rows and their materials hold (`someRowSurface`). */
export const rowsWearLobes = (rt: WebgpuPagesRuntime) => lobedRows(rt.layout.rows)

/** Whether the lobes target is full-size: a row wears a lobed surface, or a transmissive item does,
 *  whose lobes the water's surface stage leaves there (`../../water/lobedStage.ts`). */
export const wantsPhysicalLobes = (rt: WebgpuPagesRuntime) =>
  rowsWearLobes(rt) || rt.blendState.waterLobed

/** Whether the lobes target of the drawn view holds every pixel. */
export const lobesHeld = ({ gpu: { surfaces } }: WebgpuPagesRuntime) =>
  !!surfaces && holds(surfaces, surfaces.lobes)

/**
 * At every image's start, its rows written, before anything names the target (`encodeVis`) — an
 * image with no opaque row too, whose transmissive lobed surfaces leave their lobes there: the
 * lobes target is full-size while a surface wants it, a 1×1 otherwise (`wantsPhysicalLobes`),
 * remade alone when that flips (`withLobes`) — the frame's other targets stay. The target replaced
 * is freed once the work already submitted is done: this image names the new one throughout.
 */
export function followLobes(rt: WebgpuPagesRuntime) {
  const { gpu } = rt,
    surfaces = gpu.surfaces
  if (!surfaces || !gpu.device) return
  const wanted = wantsPhysicalLobes(rt)
  if (holds(surfaces, surfaces.lobes, wanted)) return
  gpu.surfaces = withLobes(gpu.device, surfaces, wanted)
  gpu.targetBytes += gpu.surfaces.allocationBytes - surfaces.allocationBytes
  void gpu.device.queue.onSubmittedWorkDone().then(() => surfaces.lobes.destroy())
}
