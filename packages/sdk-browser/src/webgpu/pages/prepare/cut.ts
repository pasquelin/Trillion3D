import { createGpuDagSelection, packDagSelection } from '../../../gpu/dag/selection.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import type { ClusterRoot, PageRec } from '../../../page/selection/types.ts'
import { linkWorldObjects } from './worldRoot.ts'
import type { DagCapacity } from '../../../gpu/dag/pack.ts'
import type { GpuSelection } from '../../../gpu/core/selection.ts'
import { composedRoot } from '../../../placement/gpuCompose.ts'

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
  if (!made.cut) throw new Error(`GPU_SELECTION_REFUSED: ${made.refused}`)
  adoptCut(rt, made.cut)
  // ABSOLUTE world matrices on the GPU, no render origin yet: the first image brings them back.
  run.worldUploadOrigin.fill(NaN)
}

/** The session's GPU cut over `roots` — at open, exactly theirs, or beside the running one for a
 *  growth in place (`../../../placement/webgpuGrowth.ts`), at the grown `capacity` later growths
 *  append into, the pages the pool holds listed at once (`poolHeld`) —, or why the device refused
 *  it, said by name. Its placement tree opens the groups of the roots a parent composes on the GPU,
 *  read off the one compose state whenever it is refitted (`composedRoot`). */
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
    composed: (rank) => composedRoot(rt, rank),
  })
  return { cut, refused }
}

/**
 * `cut` becomes the session's, at open or for a growth: the one place a cut takes over what
 * followed the one it replaces. Each placement draws the object its row places now
 * (`linkWorldObjects`), the world DAG standing in for it where its group suffices (`worldRoot.ts`):
 * a row moved while the cut was being made included. The listener the links tell (`linkMoved`)
 * passes to it, told each placement whose standing differs between the two cuts. The old cut is
 * let go.
 */
export function adoptCut(
  rt: Pick<WebgpuPagesRuntime, 'context' | 'layout' | 'run'>,
  cut: GpuSelection,
) {
  const { run, layout } = rt,
    old = run.gpuSelection
  linkWorldObjects(rt.context, cut, layout.selectionRoots)
  const listener = old?.linkMoved
  if (old && listener) {
    cut.linkMoved = listener
    for (let rank = 0; rank < layout.selectionRoots.length; rank++)
      if (!!old.worldStandsIn?.(rank) !== !!cut.worldStandsIn?.(rank)) listener(rank)
  }
  old?.dispose()
  run.gpuSelection = cut
}
