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

/** The page budget's verdict just changed (`../residency/pageBudgetLadder.ts`): both engines
 *  publish it under one phase. */
export const sendCoverageBudget = (
  onDiagnostic: ((diagnostic: BackendDiagnostic) => void) | undefined,
  event: Record<string, unknown>,
) => sendEngineDiagnostic(onDiagnostic, 'coverage-budget', 'Admission of the requested cut', event);
