import { DIAGNOSTICS, type DiagnosticMode } from '../../../sdk-core/src/runtime/diagnostics.ts'
import type { Engine } from '../session/engine/types.ts'

type Inputs = {
  check: () => void
  engine: Engine
  setMode: (mode: DiagnosticMode) => void
}

export function createExplorerDiagnosticApi(inputs: Inputs) {
  const { check, engine, setMode } = inputs
  return {
    setDiagnostic(mode: DiagnosticMode) {
      check()
      if (!DIAGNOSTICS[mode].available) throw new Error(DIAGNOSTICS[mode].reason)
      engine.setDiagnostic(mode)
      setMode(mode)
    },
    /** Holds the main view's cut — levels, HLOD, frustum, occlusion — at the camera it has now, or
     *  follows the camera again. */
    freezeCut(frozen: boolean) {
      check()
      engine.freezeCut(frozen)
    },
  }
}
