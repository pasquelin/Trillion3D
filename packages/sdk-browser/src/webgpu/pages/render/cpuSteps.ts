import { CPU_STEP } from './cpuStepTable.ts'
import {
  frameCostAuditEnabled,
  gpuFrameCostSnapshot,
  logFrameCostAudit,
} from '../../../frame/costAudit.ts'
import type { HostCpuStep } from '../../../host/cpuProfile.ts'
import { debugMode } from '../../../host/debugMode.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'

/** Attaches the image's counters to the public per-stage profile, when it is mounted. */
function recordStages(rt: WebgpuPagesRuntime) {
  const { timing, lights, bounce } = rt,
    { stages } = timing.profiler
  if (!stages) return
  const tiles = rt.vis.textures?.counters
  if (tiles)
    stages.setCounts('textures', {
      tilesRequested: tiles.requested,
      tilesAtLevel: tiles.atLevel,
      missingLevels: Math.round(tiles.missingAverage * 100),
      tilesServed: tiles.served,
      tilesPending: tiles.pending,
      tilesDeferred: tiles.deferred,
    })
  if (!tiles?.worked)
    stages.setReason('textures', {
      cpu: 'no image feedback: no tile to serve',
      gpu: 'transfers go through the GPU queue, with no timestamped pass',
    })
  stages.setCounts('lightLists', { activeLights: lights.lightsActive })
  // What bounce actually did: probes and rays, never a duration. A still, converged scene encodes
  // no pass, so the stage stays "unmeasured" and not zero.
  stages.setCounts('bounce', {
    probesUpdated: bounce.probesUpdated,
    raysPerFrame: bounce.raysLaunched,
    cascadeProbes: bounce.probes?.cascades.probes ?? 0,
    texelsUpdated: bounce.encoded ? (bounce.probes?.surface.lastTexels ?? 0) : 0,
    cachedTexels: bounce.probes?.surface.texels ?? 0,
    // Fraction of the ceiling the millisecond budget holds, in thousandths: a count is an integer,
    // and it is the duration that decides this count, never the reverse.
    budgetFraction: Math.round((bounce.probes?.budget.load ?? 0) * 1000),
  })
  if (!bounce.probes)
    stages.setReason('bounce', {
      cpu: bounce.reason ?? 'bounce absent',
      gpu: bounce.reason ?? 'bounce absent',
    })
  // Diagnostic only: transparent overdraw count, when the variant mounts it. The per-pixel maximum
  // is not measurable by occlusion query: it is not published.
  const overdraw = rt.blendState.overdraw
  if (overdraw)
    stages.setCounts('transparents', overdraw.pull(rt.gpu.targetSize[0] * rt.gpu.targetSize[1]))
  // Occupancy of the cut: how many clusters the DAG holds, how many the frustum and nodes reject,
  // how many the cut keeps. That ratio says what a kernel that visits every cluster costs versus
  // only the live ones.
  stages.setCounts('selection', {
    clustersRejected: rt.run.frustumRejected,
    pagesWanted: rt.run.visible,
    dagClusters: rt.run.gpuSelection?.pageCount ?? 0,
  })
  stages.setCounts('animations', timing.worldCounts)
  stages.setCounts('partition', timing.partitionCounts)
  timing.encodeCounts.drawCalls = rt.run.gpuDrawCalls
  timing.encodeCounts.blendDrawCalls = rt.run.blendDrawCalls
  timing.encodeCounts.computeDispatches = rt.run.gpuComputeDispatches
  stages.setCounts('encode', timing.encodeCounts)
}

/**
 * Publishes where the image's CPU time went, on the cadence of the progress diagnostic: a measured
 * loop renders without ever flushing, and the profile is exactly what such a loop needs.
 */
function publishCpuProfile(rt: WebgpuPagesRuntime) {
  const { timing, run, diag } = rt
  if (
    (diag.traceEnabled && !frameCostAuditEnabled()) ||
    !timing.cpuSample ||
    run.frame === timing.lastCpuLogFrame
  )
    return
  const now = performance.now()
  if (now - timing.lastCpuLogMs < 2000) return
  timing.lastCpuLogMs = now
  timing.lastCpuLogFrame = run.frame
  const details = {
    ...timing.cpuSample,
    steps: timing.publishedSteps.read(),
    audit: gpuFrameCostSnapshot(rt),
  }
  diag.engineDiagnostic('cpu-timing', 'CPU timings measured in the engine', details)
  logFrameCostAudit({ kind: 'cpu-profile', ...details })
}

/** Deposits the duration of a host-sampled step: arrivals, wait, retain, submit. */
export function hostCpuStep(rt: WebgpuPagesRuntime, step: HostCpuStep, ms: number) {
  rt.timing.profiler.row[CPU_STEP[step]] = ms
}

/**
 * Closes the image on the host side: bounds the host samples after the render belong to the image
 * that just drew, so the row is filed only here. An image that has not filled a row — an image
 * waiting for coverage — deposits nothing rather than a row of zeros. Nor does an image no one
 * profiles: the windows are filed in debug mode, for the stage profile, or for a listened
 * channel or the frame audit, which publish them.
 */
export function endCpuFrame(rt: WebgpuPagesRuntime) {
  const { timing, run } = rt
  if (!timing.rowFilled) return
  timing.rowFilled = false
  const { profiler } = timing
  if (!(profiler.stages || rt.diag.listened || debugMode() || frameCostAuditEnabled())) return
  profiler.record(run.frame, profiler.row[CPU_STEP.totalMs])
  recordStages(rt)
  publishCpuProfile(rt)
}
