import type { EngineContext } from '../../engine/types.ts'

type Inputs = {
  check: () => void
  context: EngineContext
}

/** The cut's screen error the engine selects clusters by, read by its next frame. */
export function createExplorerSelectionApi(inputs: Inputs) {
  const { check, context } = inputs
  return {
    setPixelError(value: number) {
      check()
      if (!Number.isFinite(value) || value < 0) throw new Error('Invalid pixelError')
      context.pixelError = value
    },
  }
}
