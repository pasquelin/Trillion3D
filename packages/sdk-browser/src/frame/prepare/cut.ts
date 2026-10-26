import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { createGpuDagSelection } from '../../geometry/dag/selection/selection.ts'
import { packDagSelection } from '../../geometry/dag/pack/pack.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { ClusterRoot, PageRec } from '../../geometry/selection/types.ts'
import { linkWorldCells } from './worldRoot.ts'
import type { DagCapacity } from '../../geometry/dag/pack/packCapacity.ts'
import type { GpuSelection } from '../../gpu/core/selection.ts'
import { rootsOnGpu } from '../../placement/roots/rootPasses.ts'
import { deriveEveryRoot } from '../../placement/roots/rootMoves.ts'
import { admitCutTables } from './targetFunding.ts'
import { log } from '../../diagnostic/log.ts'
import { cutListCaps } from '../../geometry/dag/lists/cutListCaps.ts'
import { requestBounds } from '../../geometry/dag/lists/requestSize.ts'

/**
 * The GPU cut, the engine's one cut (#1483): one thread per cluster, each with its own error band.
 * The clusters it draws are a list it writes each frame, sized by what the view asks
 * (`../../geometry/dag/visible/visibleGrowth.ts`), so nothing grows with the placements (#1232). A
 * device that cannot hold it refuses the scene by name: nothing else would draw it. `step` is prepare's, which a close or a loss stops.
 */
export async function prepareGpuCut(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  step: <T>(name: string, work: () => Promise<T>) => Promise<T>,
) {
  const { selectionRoots } = rt.layout
  if (!selectionRoots.length) return
  const made = await step('GPU cut', () => createSessionCut(rt, gpuDevice, selectionRoots))
  if (!made.cut) throw new Error(`GPU_SELECTION_REFUSED: ${made.refused}`)
  adoptCut(rt, made.cut)
}

/** The session's GPU cut over `roots` — at open, exactly theirs, or beside the running one for a
 *  growth in place (`../../placement/growth/webgpuGrowth.ts`), at the grown `capacity` later growths
 *  append into —, or why the device refused it, said by name. Before each of its cuts the roots'
 *  worlds, boxes and stretches are written on the GPU, and its placement tree's leaves from them
 *  (`rootsOnGpu`). */
export async function createSessionCut(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  roots: readonly ClusterRoot<PageRec>[],
  capacity?: DagCapacity,
) {
  let refused = 'camera cut creation failed'
  // At open, each sub-step is prepare's step too: an opening that waits names the one it waits
  // in. A growth beside a running cut prepares nothing.
  const progress = capacity
    ? undefined
    : (note: string) => rt.context.preparationStep?.(`GPU cut: ${note}`)
  progress?.('pack, at 0.0 s')
  const packStart = cpuNow()
  const packed = packDagSelection(roots, capacity)
  const pack = { step: 'pack', ms: Math.round(msSince(packStart)) }
  const cut = await createGpuDagSelection(gpuDevice, packed, {
    diagnosticGpuVariant: rt.context.diagnosticGpuVariant,
    onRefused: (reason, details) => {
      refused = reason
      rt.diag.engineDiagnostic('gpu-selection-refused', 'The device cannot hold the GPU cut', {
        kind: 'error',
        reason,
        ...details,
      })
    },
    roots: rootsOnGpu(rt),
    admit: (bytes) => admitCutTables(rt, bytes),
    progress,
    timed: ({ took, ms }) => reportCutSteps(rt, { took: [pack, ...took], ms: pack.ms + ms }),
    // Its lists at the session's caps, their warnings said as the engine's (`cutMaxNodes`, …), its
    // readout within the session's bounds (`streamingMinRequests`, `streamingMaxRequests`).
    lists: cutListCaps(rt.context),
    requests: requestBounds(rt.context),
    clipPlane: !!rt.setup.clipping,
    onListNote: (message, details) =>
      rt.diag.engineDiagnostic('gpu-cut-lists', message, { kind: 'warning', ...details }),
  })
  return { cut, refused }
}

/** A cut's making slower than a second is a wait a page notices: the console names what each
 *  sub-step took, as the diagnostics do for every making (`gpu-cut-steps`). */
const SLOW_CUT_MS = 1000

/** What each sub-step of a cut's making took (`cutSteps.ts`): said, and printed when slow. */
function reportCutSteps(
  rt: WebgpuPagesRuntime,
  made: { took: { step: string; ms: number }[]; ms: number },
) {
  rt.diag.engineDiagnostic('gpu-cut-steps', 'The GPU cut was made', {
    kind: 'preparation',
    ...made,
  })
  if (made.ms < SLOW_CUT_MS) return
  const steps = made.took.map(({ step, ms }) => `${step} ${ms} ms`).join(', ')
  log.warn(`GPU cut made in ${made.ms} ms: ${steps}`)
}

/**
 * `cut` becomes the session's, at open or for a growth: the one place a cut takes over what
 * followed the one it replaces. Each placement lies in the HLOD 0 cell its row lies in now
 * (`linkWorldCells`, `worldRoot.ts`): a row moved while the cut was being made included. The old
 * cut is let go.
 */
export function adoptCut(
  rt: Pick<WebgpuPagesRuntime, 'context' | 'layout' | 'run' | 'gpu' | 'rootWorlds'> &
    Partial<Pick<WebgpuPagesRuntime, 'services'>>,
  cut: GpuSelection,
) {
  const { run, layout } = rt,
    old = run.gpuSelection
  linkWorldCells(cut, layout.selectionRoots)
  // The poses the last drawn frame drew, which the velocity and the occlusion measure from, cross
  // the swap: the new tables were packed at older ones.
  if (old) cut.keepPosesOf(old)
  old?.dispose()
  run.gpuSelection = cut
  // Its frame words were packed from the CPU's stretches: the GPU's are written into them again.
  deriveEveryRoot(rt)
}
