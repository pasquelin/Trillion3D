import { createGpuDagSelection, packDagSelection } from '../../../gpu/dag/selection.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts'
import { linkWorldObjects } from './worldRoot.ts'
import { SELECTION_NONE as NONE } from '../../../gpu/core/selection.ts'
import type { DagCapacity } from '../../../gpu/dag/pack.ts'

/**
 * The GPU cut, the engine's one cut (#1483): one thread per cluster, each with its own error band.
 * Its rows are a cache of what it draws, sized by the view (`../../row/slots.ts`), so neither grows
 * with the placements (#1232). A device that cannot hold it refuses the scene by name: nothing else
 * would draw it. `step` is prepare's, which a close or a loss stops.
 */
export async function prepareGpuCut(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  step: <T>(name: string, work: () => Promise<T>) => Promise<T>,
) {
  const { vis, run } = rt,
    { selectionRoots } = rt.layout
  if (!selectionRoots.length) return
  if (!vis.gpuDraw) throw new Error('WEBGPU_DRAW_UNAVAILABLE')
  const made = await step('GPU cut', () => createSessionCut(rt, gpuDevice, selectionRoots))
  run.gpuSelection = made.cut
  if (!run.gpuSelection) throw new Error(`GPU_SELECTION_REFUSED: ${made.refused}`)
  // ABSOLUTE world matrices on the GPU, no render origin yet: the first image brings them back.
  run.worldUploadOrigin.fill(NaN)
}

/** The session's GPU cut over `roots` — at open, exactly theirs, or beside the running one for a
 *  growth in place (`../../../placement/webgpuGrowth.ts`), at the grown `capacity` later growths
 *  append into, the pages the pool holds listed at once (`poolHeld`) —, or why the device refused
 *  it, said by name. Each placement packed is linked to the world object it draws. */
export async function createSessionCut(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  roots: readonly ClusterRoot<PageRec>[],
  poolHeld?: (page: number) => boolean,
  capacity?: DagCapacity,
) {
  let refused = 'camera cut creation failed'
  const cut = await createGpuDagSelection(gpuDevice, packDagSelection(roots, capacity), {
    diagnosticGpuVariant: rt.context.diagnosticGpuVariant,
    onRefused: (reason, details) => {
      refused = reason
      rt.diag.engineDiagnostic('gpu-selection-refused', 'The device cannot hold the GPU cut', {
        kind: 'error',
        reason,
        ...details,
      })
    },
    poolHeld,
  })
  // Each row placed already draws its world object: the world DAG stands in for it where its
  // group suffices (`worldRoot.ts`).
  if (cut) {
    linkWorldObjects(rt.context, cut, roots)
    // The roots a parent composes on the GPU open their tree groups in the new cut too.
    rt.compose?.parentOf.forEach(
      (slot, rank) => slot !== NONE && cut.composedPlacement?.(rank, true),
    )
  }
  return { cut, refused }
}
