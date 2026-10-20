import { taaRuns } from '../backend/state/renderScale.ts'
import { effectsMoved } from '../render/encodeEffects.ts'
import { guidesMoved } from '../render/encodeGuides.ts'
import { particlesMoved } from '../../particles/gpu/webgpuParticleFrame.ts'
import { lobesHeld } from '../prepare/lobesTarget.ts'
import { pipelinesCompiling } from '../../lighting/deferred/compileLedger.ts'
import { unsettledReasons } from './unsettled.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'

/**
 * Why a frame was drawn rather than held (`holdWebgpuFrame`), said as a trace — a session whose
 * `diagnosticDetail` asks past the summary —: the hold witness (`stable`, the revisions it kept, the
 * signature of the last frame), the pending work by name (`unsettledReasons`), the targets swapped
 * in, the temporal pass running, the guides, effects and particles, and the lobes. A still
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
    moved: { guides: guidesMoved(rt), effects: effectsMoved(rt), particles: particlesMoved(rt) },
    compiling: pipelinesCompiling(rt.gpu.device),
    lobes: { blended: blendState.lobed, held: lobesHeld(rt) },
  }))
}
