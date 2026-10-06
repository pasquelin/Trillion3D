// The shadow maps' frame end: what this frame hands the next, and the counters read back late.
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import { VSM_COUNTERS } from '../../../../vsm/constants.ts'
import { finishVirtualShadowFrame } from '../../../../vsm/frameSetup.ts'
import { keepVsmFrame } from '../../../../vsm/pageManagementPass.ts'
import { noteVsmFrame, stampVsmStats } from '../../state/vsmSettle.ts'
import type { EngineVsm } from './engineVsm.ts'

/** Frame end: the feedback copy, the rendered marks and the frame data extraction (the frame's buffers become
 *  the previous frame's). */
export function finishVsmFrame(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const vsm = rt.lights.vsm,
    plan = vsm?.plan
  if (!vsm || !plan) return
  vsm.plan = undefined
  const hasData = plan.projectionCount > 0
  if (hasData) vsm.feedback.encode(encoder, vsm.res.feedback)
  if (hasData && vsm.countersOn) {
    const staging = vsm.statsReadback.take()
    if (staging) {
      encoder.copyBufferToBuffer(vsm.res.stats, 0, staging, 0, VSM_COUNTERS * 4)
      stampVsmStats(vsm.settle, staging, rt.run.frame)
    }
  }
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
  keepVsmFrame(vsm.res, { mapsGranted: hasData })
  vsm.stats.freePages = vsm.state.cache.lastFreePages ?? 0
}

/** After the frame's submit: the feedback and counters copies map, and land a few frames late. */
export function vsmSubmitted(rt: { lights: { vsm?: EngineVsm } }) {
  const vsm = rt.lights.vsm
  if (!vsm) return
  vsm.feedback.afterSubmit()
  vsm.transmission?.afterSubmit()
  vsm.statsReadback.submitted()
}
