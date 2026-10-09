/**
 * GPU cut of a cluster DAG (`errorModel: dag-group-qem-v3`).
 *
 * Every cluster carries its own screen-error band, so no cluster depends on another. One thread per
 * candidate cluster evaluates `parentErrorPx > pixelError >= lodErrorPx` with the same projection as
 * `clusterErrorPixels`; the candidates come from a level-by-level descent of the primitive's culling
 * hierarchy, one indirect pass per level, which rejects a whole subtree at once (out of frustum, or
 * a subtree whose largest replacement error already fits the budget) and never reads the clusters
 * below it. Rejection there is a pure accelerator: a node's box contains every cluster box below it
 * and its `maxParentError` bounds every `parentError` below it, so the selected set is identical
 * with or without the hierarchy.
 */
import { cutSteps, type CutProgress, type CutSteps } from './cutSteps.ts'
import type { GpuSelection } from '../core/selection.ts'
import type { PackedDag } from './types.ts'
import { selectionRepeat, type DiagnosticGpuVariant } from '../../diagnostic/gpuVariant.ts'
import { createDagResources } from './resources.ts'
import { createDagRuntime } from './runtime.ts'
import { dagDeviceRefusal } from './deviceRefusal.ts'
import { cutHeldSlots } from './listCap.ts'
import type { CutAdmission } from './cutBuffers.ts'
export { packDagSelection } from './pack.ts'
export type { PackedDag } from './types.ts'

export async function createGpuDagSelection(
  device: GPUDevice,
  packed: PackedDag,
  options: {
    diagnosticGpuVariant?: DiagnosticGpuVariant
    /** Told why a scene that has a cut gets no GPU cut: the host refuses the scene by name. */
    onRefused?: (reason: string, details?: Record<string, unknown>) => void
    /** The pages the pool already holds: a cut made beside a running one (a growth in place). */
    poolHeld?: (page: number) => boolean
    /** Whether a parent composes placement `w` on the GPU now: its tree group stays open. */
    composed?: (w: number) => boolean
    /** The rows the session's row cache holds: the open counts placements hold follow them. */
    rows?: number
    /** The most its tables may hold (`../../residency/cutTableBytes.ts`): past it, refused. */
    share?: number
    /** The session's budget, asked before each buffer of its tables is made (`CutAdmission`). */
    admit?: CutAdmission
    /** Told each sub-step of the making as it begins (`cutSteps.ts`). */
    progress?: CutProgress
    /** Told what each sub-step took once the making is over, made or refused. */
    timed?: (steps: ReturnType<CutSteps['end']>) => void
  } = {},
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
  )
  options.timed?.(steps.end())
  if (!resources) {
    options.onRefused?.(`camera cut creation failed: ${why}`, { why })
    return undefined
  }
  return createDagRuntime(resources, options.poolHeld, options.composed)
}
