import type { EngineDiagnostic } from '../engine/types.ts'

/** One engine diagnostic to the host's observer, versioned: an error the observer throws is its
 *  own, never the frame's. */
export function sendEngineDiagnostic(
  onDiagnostic: ((diagnostic: EngineDiagnostic) => void) | undefined,
  phase: string,
  message: string,
  details: Record<string, unknown>,
) {
  try {
    onDiagnostic?.({ phase, message, context: { pipelineVersion: 1, ...details } })
  } catch {
    /* Observers do not control rendering. */
  }
}

/** The page budget's verdict just changed: the cut sampled at `pixelError` asked for
 *  `requiredSlots` against `slots` — `null` when the engine does not know it without a pass it
 *  did not run. The engine builds it here and publishes it under one phase, from its flush. */
export const coverageBudgetEvent = (
  limited: boolean,
  requiredSlots: number | null,
  slots: number,
  fallbackRetained: boolean,
  pixelError: number,
) => ({ version: 1, limited, requiredSlots, slots, fallbackRetained, pixelError })

export const sendCoverageBudget = (
  onDiagnostic: ((diagnostic: EngineDiagnostic) => void) | undefined,
  event: Record<string, unknown>,
) => sendEngineDiagnostic(onDiagnostic, 'coverage-budget', 'Admission of the requested cut', event)

/** A diagnostic whose detail is built only when it is heard. */
export type LazyDiagnostic = (
  phase: string,
  message: string,
  detail: () => Record<string, unknown>,
) => void
/** The emitter that tells `report`, or `undefined` when nobody listens. Callers write
 *  `emit?.(phase, message, () => detail)`: with no listener the call short-circuits before its
 *  arguments, so neither the detail nor the closure that builds it is ever allocated — a request
 *  pays nothing for diagnostics that are off. An error the observer throws is its own. */
export const lazyDiagnostic = (
  report: ((diagnostic: EngineDiagnostic) => void) | undefined,
): LazyDiagnostic | undefined =>
  report &&
  ((phase, message, detail) => {
    try {
      report({ phase, message, context: detail() })
    } catch {
      /* Observers cannot alter streaming. */
    }
  })
