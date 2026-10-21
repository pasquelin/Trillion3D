/**
 * GPU cut of a cluster DAG (`errorModel: dag-group-qem-v4`).
 *
 * Every cluster carries its own screen-error band, so no cluster depends on another. One thread per
 * candidate cluster draws it when its parent's error shows past the threshold at its sphere's
 * nearest edge scale and its own does not (`../shader/error.ts`); the candidates come from a
 * level-by-level descent of the primitive's culling hierarchy, one indirect pass per level, which
 * rejects a whole subtree at once — out of the frustum, its largest replacement error already
 * within the threshold, or hidden by the pyramid (`../shader/occlusionWgsl.ts`) — and never reads
 * the clusters below it.
 */
import { cutSteps, type CutProgress, type CutSteps } from '../cut/cutSteps.ts'
import type { GpuSelection } from '../../../gpu/core/selection.ts'
import type { PackedDag } from '../types.ts'
import { selectionRepeat, type DiagnosticGpuVariant } from '../../../diagnostic/gpuVariant.ts'
import { createDagResources } from '../resources.ts'
import { createDagRuntime } from '../runtime/runtime.ts'
import type { RootsOnGpu } from '../runtime/runtimeOps.ts'
import { dagDeviceRefusal } from '../deviceRefusal.ts'
import { cutHeldSlots } from '../lists/listCap.ts'
import type { CutAdmission } from '../cut/cutBuffers.ts'
import type { DagResources, ListNote, RowCutPass } from '../resources.ts'
import type { CutListCaps } from '../lists/cutListCaps.ts'

export async function createGpuDagSelection(
  device: GPUDevice,
  packed: PackedDag,
  options: {
    diagnosticGpuVariant?: DiagnosticGpuVariant
    /** Told why a scene that has a cut gets no GPU cut: the host refuses the scene by name. */
    onRefused?: (reason: string, details?: Record<string, unknown>) => void
    /** What the session writes of its roots on the GPU before every cut, the tree's leaves among
     *  them (`RootsOnGpu`): the stretch's one writer — a cut without it projects every cluster to
     *  nothing —, so never optional. */
    roots: RootsOnGpu
    /** The rows the session's row cache holds: the open counts placements hold follow them. */
    rows?: number
    /** The most its tables may hold (`../../../session/memory/cutTableBytes.ts`): past it, refused. */
    share?: number
    /** The session's budget, asked before each buffer of its tables is made (`CutAdmission`). */
    admit?: CutAdmission
    /** Told each sub-step of the making as it begins (`../cut/cutSteps.ts`). */
    progress?: CutProgress
    /** Told what each sub-step took once the making is over, made or refused. */
    timed?: (steps: ReturnType<CutSteps['end']>) => void
    /** The row cache's pass on the cut, made over its resources (`RowCutPass`). */
    rowPass?: (cut: DagResources) => RowCutPass
    /** The caps its lists are laid out for, the session's settings (`../lists/cutListCaps.ts`);
     *  the reference's defaults when absent. */
    lists?: CutListCaps
    /** Where the cut says its lists' warnings — an overflow past a cap, caps the device refused. */
    onListNote?: ListNote
  },
): Promise<GpuSelection | undefined> {
  if (packed.pageCount < 1) return undefined
  const refusal = dagDeviceRefusal(device.limits, packed)
  if (refusal) {
    options.onRefused?.('camera cut past the device limits', refusal)
    return undefined
  }
  let why = ''
  const steps = cutSteps(options.progress)
  const resources = await createDagResources(
    device,
    packed,
    selectionRepeat(options.diagnosticGpuVariant),
    undefined,
    (reason) => (why = reason),
    options.rows === undefined
      ? undefined
      : cutHeldSlots(device.limits, packed.live?.pages ?? packed.pageCount, options.rows),
    options.share,
    options.admit,
    steps,
    options.lists,
  )
  options.timed?.(steps.end())
  if (!resources) {
    options.onRefused?.(`camera cut creation failed: ${why}`, { why })
    return undefined
  }
  resources.rowPass = options.rowPass?.(resources)
  resources.listNote = options.onListNote
  return createDagRuntime(resources, options.roots)
}
