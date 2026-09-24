import type { BackendDiagnostic } from '../backend/types.ts';

/** One engine diagnostic to the host's observer, versioned: an error the observer throws is its
 *  own, never the frame's. */
export function sendEngineDiagnostic(
  onDiagnostic: ((diagnostic: BackendDiagnostic) => void) | undefined,
  phase: string,
  message: string,
  details: Record<string, unknown>,
) {
  try {
    onDiagnostic?.({ phase, message, context: { pipelineVersion: 1, ...details } });
  } catch {
    /* Observers do not control rendering. */
  }
}

/** Publishes an engine diagnostic: the engine's own channel, one per backend. */
export type EngineDiagnosticEmitter = (
  phase: string,
  message: string,
  details: Record<string, unknown>,
) => void;

/** The page budget's verdict just changed: the cut sampled at `pixelError` asked for
 *  `requiredSlots` against `slots` — `null` when the engine does not know it without a pass it
 *  did not run. Both engines build it here and publish it under one phase, from their flush. */
export const coverageBudgetEvent = (
  limited: boolean,
  requiredSlots: number | null,
  slots: number,
  fallbackRetained: boolean,
  pixelError: number,
) => ({ version: 1, limited, requiredSlots, slots, fallbackRetained, pixelError });

export const sendCoverageBudget = (emit: EngineDiagnosticEmitter, event: Record<string, unknown>) =>
  emit('coverage-budget', 'Admission of the requested cut', event);
