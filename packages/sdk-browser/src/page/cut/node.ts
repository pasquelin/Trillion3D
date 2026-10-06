import type { PageRecord, SelectionState } from './state.ts'
import { nodeDecision, nodeDecisionAtZero } from './nodeDecision.ts'

/** Decision of a subtree for the current pass: -1 reject, 1 accept, 0 undecided. */
export function subtreeDecision<T extends PageRecord>(
  s: SelectionState<T>,
  values: Float64Array,
  at: number,
  exact: boolean,
) {
  // Rest-space subtree error bounds cannot settle a deformed cut. Refine through the same walk.
  if (s.flatReach > 0) return 0
  return exact ? nodeDecisionAtZero(values, at) : nodeDecision(s, values, at)
}
