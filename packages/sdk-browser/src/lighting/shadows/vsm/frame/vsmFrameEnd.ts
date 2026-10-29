// The shadow maps' frame end: what this frame hands the next, and the counters read back late.
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { clipmapStatsSubmitted } from '../debug/clipmapStats.ts'
import { VSM_COUNTERS } from '../constants.ts'
import { finishVirtualShadowFrame } from '../frameSetup.ts'
import { keepFilterableHistory, keepVsmFrame } from '../pageManagementEncode.ts'
import { noteVsmFrame, stampVsmStats } from '../../../../frame/backend/state/vsmSettle.ts'
import type { EngineVsm } from './engineVsm.ts'
import { vsmDescentRequestsSubmitted } from '../traversal/requests.ts'

/** Frame end: the feedback copy, the uncached mark of a skipped raster and the frame data extraction
 *  (the frame's buffers become the previous frame's; a frame with no map leaves the previous one in
 *  place). */
export function finishVsmFrame(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const vsm = rt.lights.vsm,
    plan = vsm?.plan
  // The frame's projection context is this frame's alone.
  if (vsm?.frameScratch) vsm.frameScratch.projecting = false
  if (!vsm || !plan) return
  vsm.plan = undefined
  const hasData = plan.projectionCount > 0
  if (hasData) vsm.feedback.encode(encoder, vsm.res.feedback, vsm.res.stats)
  if (hasData && vsm.countersOn) {
    const staging = vsm.statsReadback.take()
    if (staging) {
      encoder.copyBufferToBuffer(vsm.res.stats, 0, staging, 0, VSM_COUNTERS * 4)
      stampVsmStats(vsm.settle, staging, rt.run.frame)
    }
  }
  // A frame with no map leaves the stats of the frame before: no row of its own.
  if (hasData)
    vsm.accumulate.encode(
      encoder,
      vsm.res.stats,
      vsm.state.maps.shadows.shadowAccumulateStats,
      (csv) => rt.diag.engineDiagnostic('shadow-stats', csv, {}),
    )
  const rendered = vsm.renderedPlan === plan
  noteVsmFrame(
    vsm.settle,
    rt.run.frame,
    plan,
    vsm.stats.invalidationThreads,
    vsm.state.cache.pressureBias,
    rendered,
  )
  finishVirtualShadowFrame(vsm.state, plan, rendered)
  vsm.renderedPlan = undefined
  // The prefiltered distant shadow's history is kept from every frame with data whose blend asks it;
  // a frame with none leaves it, as it leaves the rest of the previous frame.
  if (hasData)
    keepFilterableHistory(
      vsm.res,
      vsm.state.maps.shadows.shadowPrefilteredDistantHistoryBlendFactor > 0,
      plan.sunBase,
      encoder,
    )
  keepVsmFrame(vsm.res, hasData ? 'swap' : 'keep')
  vsm.stats.freePages = vsm.state.cache.lastFreePages ?? 0
  vsm.overflow.drain((line) => rt.diag.engineDiagnostic('shadow-overflow', line, {}))
}

/** After the frame's submit: the feedback, counters and shadow views' requests
 *  copies map, and land a few frames late. */
export function vsmSubmitted(rt: { lights: { vsm?: EngineVsm } }) {
  const vsm = rt.lights.vsm
  if (!vsm) return
  vsm.feedback.afterSubmit()
  vsm.statsReadback.submitted()
  clipmapStatsSubmitted(rt)
  vsm.accumulate.afterSubmit()
  vsmDescentRequestsSubmitted(vsm.res)
}
