import { taaRuns } from '../backend/state/renderScale.ts'
import { lobesHeld } from '../prepare/lobesTarget.ts'
import { heldCompiles, pipelinesCompiling } from '../../lighting/deferred/compileLedger.ts'
import { unsettledReasons } from './unsettled.ts'
import { everyImageTerms } from './everyImage.ts'
import { surfaceCacheWhy } from '../../lighting/surfaceCache/frame.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * Why a frame was drawn rather than held (`holdWebgpuFrame`), said as a trace — a session whose
 * `diagnosticDetail` asks past the summary —: the hold witness (`stable`, the revisions it kept, the
 * signature of the last frame), the pending work by name (`unsettledReasons`), the targets swapped
 * in, the temporal pass running, the terms that draw a quiet view again (`everyImage`,
 * `everyImage.ts`), and the lobes. A still
 * view that never holds names the term that keeps moving; a session without traces reads nothing.
 */
export function traceDrawnFrame(rt: WebgpuPagesRuntime, unsettled: number, swapped: boolean) {
  const { gate } = rt.run,
    { blendState } = rt
  rt.diag.traceDiagnostic('frame-drawn', 'Why the frame was drawn, not held', () => ({
    frame: rt.run.frame,
    stable: gate.hold.stable,
    sameRevisions: gate.hold.same(gate.revisions),
    revisions: { ...gate.revisions },
    signature: Array.from(gate.hold.sample),
    reasons: unsettledReasons(unsettled),
    swapped,
    taaRuns: taaRuns(rt),
    everyImage: everyImageTerms(rt),
    surfaceCache: surfaceCacheWhy(rt),
    compiling: pipelinesCompiling(rt.gpu.device),
    lobes: { blended: blendState.lobed, held: lobesHeld(rt) },
  }))
}

/** What a frame held on an answer waits for (`holdWebgpuFrame`), said as a trace: the targets not granted, and the labels of the compiles the frames wait for. */
export function traceHeldOnAnswer(rt: WebgpuPagesRuntime, awaited: boolean) {
  rt.diag.traceDiagnostic('frame-held-on-answer', 'What the held frame waits for', () => ({
    frame: rt.run.frame,
    targetsAwaited: awaited,
    compiles: heldCompiles(rt.gpu.device),
  }))
}
