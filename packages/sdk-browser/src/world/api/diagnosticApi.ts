import { DIAGNOSTICS, type DiagnosticMode } from '../../../../sdk-core/src/index.ts'
import type { Engine } from '../../engine/types.ts'

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
  }
}
