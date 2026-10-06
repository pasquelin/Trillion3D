import type { MeasuredCosts, SafetyConfig } from './safety.ts'

/** What one reference and candidate pair says: a reason to turn the feature off at once, or
 *  whether the candidate costs more than the disabling ratio, or at most the enabling one. */
export type EvidenceVerdict = { veto: string } | { harmful: boolean; beneficial: boolean }

const valid = (value: number | null) => value === null || (Number.isFinite(value) && value >= 0)
/** Candidate over reference; nothing against nothing is even, something against nothing is worse. */
const ratio = (a: number, b: number) => (b === 0 ? (a === 0 ? 1 : Infinity) : a / b)

/** Judges one pair of measurements against the policy's budgets; it keeps no state. */
export function judgeEvidence(
  reference: MeasuredCosts,
  candidate: MeasuredCosts,
  config: SafetyConfig,
): EvidenceVerdict {
  if (
    reference.provenance !== 'measured' ||
    candidate.provenance !== 'measured' ||
    reference.contextKey !== candidate.contextKey ||
    ![reference, candidate].every((v) =>
      [v.cpuMs, v.gpuMs, v.latencyMs, v.memoryBytes, v.evictionsPerSecond].every(valid),
    )
  )
    return { veto: 'Incomparable or invalid evidence' }
  if (config.requireGpuTiming && (reference.gpuMs === null || candidate.gpuMs === null))
    return { veto: 'GPU evidence unavailable' }
  if (config.memoryBudgetBytes !== undefined && candidate.memoryBytes === null)
    return { veto: 'Memory evidence unavailable' }
  // No ceiling is no limit. Memory is measured whenever it has a budget (refused above); an
  // unmeasured eviction rate counts as none, so missing evidence never fabricates thrashing.
  if ((candidate.memoryBytes ?? 0) > (config.memoryBudgetBytes ?? Infinity))
    return { veto: 'Circuit breaker: memory budget' }
  if ((candidate.evictionsPerSecond ?? 0) > (config.maxEvictionsPerSecond ?? Infinity))
    return { veto: 'Circuit breaker: thrashing' }
  const ratios = [
    ratio(candidate.cpuMs, reference.cpuMs),
    ratio(candidate.latencyMs, reference.latencyMs),
  ]
  if (candidate.gpuMs !== null && reference.gpuMs !== null)
    ratios.push(ratio(candidate.gpuMs, reference.gpuMs))
  return {
    harmful: ratios.some((r) => r > config.disableRatio),
    beneficial: ratios.every((r) => r <= config.enableRatio),
  }
}
