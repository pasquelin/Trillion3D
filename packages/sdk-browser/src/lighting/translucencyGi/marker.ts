import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { NO_MARKERS, type PoolMarker } from '../bounce/pool/pool.ts'
import type { TranslucencyGiState } from './gpu.ts'
import { reflectionGroupOf } from './image.ts'
import { translucencyGiKernels } from './kernels.ts'
import { TRANSLUCENCY_GI_GROUP } from './layout.ts'
import { MARK_GI_BINDING } from './markWgsl.ts'

/**
 * The marks the pool runs for the cells' probes (`MarkSurface.markers`): the cells' mark while the volume is made and reads the radiance
 * cache — the reference registers its marking only then —, else none. The pool watches the list's length with the markers' revisions
 * (`createViewWatch`, `bounce/pool/pool.ts`): a volume that starts or stops marking marks again through the list alone.
 *
 * WHEN IT RUNS. In the pool's pass (`encodePass`, `encodeDirectLights`), ahead of the update that consumes the marks, and AFTER the visibility passes of
 * this very image (`encodeVis.ts`: `encodeWebgpuVisibilityPasses` — the opaque depth in level 0 and the culling layer's farthest built from
 * the whole depth, `passes.ts` — then `encodeSurfaceLighting`): the cells are marked against this image's opaque depth, as the reference marks
 * against this image's farthest depth. The mark reads the opaque depth and the culling layer alone (`giVisible`, `hizOpaqueDepth`,
 * `hizCellCullFarthest`), which the transparents' front pass and the combined pyramid's full build (`encodeDepthPyramid`) leave as they are:
 * nothing waits for them.
 *
 * WHAT IS THIS IMAGE'S, AND WHAT LAGS. The image has ONE submit (`submitColorCopy`), and every uniform is written with `queue.writeBuffer`,
 * which the queue runs before that submit's commands whatever the order the CPU wrote it in: the mark pass reads this image's frame of the
 * volume (`writeGiFrame`, written after the pool's pass is encoded), view of the lighting (`deferred.update`) and view of the reflections
 * (`writeFrame`). What the pool reads at ENCODE time is the volume's state as the image before left it: `marking` (a volume that starts or
 * stops marking does so one image later, through the list's length), its buffers (`held.resources`, replaced past a resize after the mark was
 * encoded: that image marks with the old frame buffer, retired after the submit — `giveBack` — and the old grid) and `published.grid`,
 * the extent of the dispatch (a grid that grew is marked whole from the next image; a grid that shrank is cut by `gi.grid` in the pass).
 */
export function translucencyGiMarkers(rt: WebgpuPagesRuntime): readonly PoolMarker[] {
  const held = rt.gpu.translucencyGi
  return held?.marking && held.resources ? held.markers : NO_MARKERS
}

/** The mark of the cells' probes (`PoolMarker`), its bind group made again only when the pool's buffers moved; its revision is the state's
 *  `markRevision` (`frame.ts`). */
export function markerOf(rt: WebgpuPagesRuntime, held: TranslucencyGiState): PoolMarker {
  const bound = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return {
    get revision() {
      return held.markRevision
    },
    mark(pass, grid, marks) {
      const device = rt.gpu.device
      const kernels = device && translucencyGiKernels(device)
      const reflection = reflectionGroupOf(rt)
      if (!device || !kernels || !reflection || !held.resources) return
      const { frame } = held.resources
      bound.next[0] = frame
      bound.next[1] = grid
      bound.next[2] = marks
      bound.next[3] = kernels.mark.layout
      if (!group || bound.moved())
        group = device.createBindGroup({
          layout: kernels.mark.layout,
          entries: namedEntries(MARK_GI_BINDING, {
            frame: { buffer: frame },
            grid: { buffer: grid },
            marks: { buffer: marks },
          }),
        })
      const cells = held.published.grid
      pass.setPipeline(kernels.mark.pipelines.markCells)
      pass.setBindGroup(0, group)
      pass.setBindGroup(1, reflection)
      pass.dispatchWorkgroups(
        ceilDiv(cells[0], TRANSLUCENCY_GI_GROUP),
        ceilDiv(cells[1], TRANSLUCENCY_GI_GROUP),
        Math.max(cells[2], 1),
      )
    },
  }
}
