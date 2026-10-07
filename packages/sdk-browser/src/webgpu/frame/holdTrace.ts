import { taaSettled } from '../../taa/frame.ts'
import { effectsMoved } from '../pages/render/encodeEffects.ts'
import { guidesMoved } from '../pages/render/encodeGuides.ts'
import { particlesMoved } from '../particles/webgpuParticleFrame.ts'
import { lobesHeld } from '../pages/prepare/lobesTarget.ts'
import { pipelinesCompiling } from '../../lighting/deferred/compileLedger.ts'
import { unsettledReasons } from './unsettled.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/**
 * Why a frame was drawn rather than held (`holdWebgpuFrame`), said as a trace — a session whose
 * `diagnosticDetail` asks past the summary —: the hold witness (`stable`, the revisions it kept, the
 * signature of the last frame), the pending work by name (`unsettledReasons`), the targets swapped
 * in, the temporal average, the guides, effects and particles, and the lobed water stage. A still
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
    taaSettled: taaSettled(rt),
    moved: { guides: guidesMoved(rt), effects: effectsMoved(rt), particles: particlesMoved(rt) },
    compiling: pipelinesCompiling(rt.gpu.device),
    water: {
      lobed: blendState.waterLobed,
      lobesHeld: lobesHeld(rt),
      stageReady: !!blendState.water?.lobed.get(),
    },
  }))
}
