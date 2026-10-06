import { judgeEvidence } from './safetyEvidence.ts'
/** How much of the engine a machine may run: everything, a reduced set, or the basics. */
export type CapabilityTier = 'full' | 'degraded' | 'baseline'
/** What the safety policy decided, and why. */
export interface SafetyDecision {
  /** The level granted. */
  tier: CapabilityTier
  /** Whether the feature is on. */
  enabled: boolean
  /** Why. */
  reason: string
  /** When it last changed. */
  changedAt: number
  /** How many times it changed. */
  revision: number
}
/** What a feature cost, measured on this machine. */
export interface MeasuredCosts {
  /** Where it was measured. */
  contextKey: string
  /** Always `'measured'`: never a guess. */
  provenance: 'measured'
  /** CPU time. */
  cpuMs: number
  /** GPU time. */
  gpuMs: number | null
  /** Delay it added. */
  latencyMs: number
  /** Memory it used. */
  memoryBytes: number | null
  /** Evictions it caused per second. */
  evictionsPerSecond: number | null
}
/** When the safety policy turns a feature off or back on. */
export interface SafetyConfig {
  /** Samples needed before deciding. */
  minimumSamples: number
  /** Shortest time between two changes. */
  minimumPeriodMs: number
  /** Cost ratio that turns it off. */
  disableRatio: number
  /** Cost ratio that turns it back on. */
  enableRatio: number
  /** Bad samples in a row before turning off. */
  consecutiveViolations: number
  /** Memory ceiling, finite and at least 0. */
  memoryBudgetBytes?: number
  /** Eviction ceiling per second, finite and at least 0. */
  maxEvictionsPerSecond?: number
  /** Whether GPU time must be measured. */
  requireGpuTiming?: boolean
}
/** Policy evaluates evidence; it never fabricates a reference or samples a clock itself. */
export function createSafetyPolicy(config: SafetyConfig) {
  if (
    !Number.isInteger(config.minimumSamples) ||
    config.minimumSamples < 1 ||
    !Number.isInteger(config.consecutiveViolations) ||
    config.consecutiveViolations < 1 ||
    !Number.isFinite(config.minimumPeriodMs) ||
    config.minimumPeriodMs < 0 ||
    !Number.isFinite(config.enableRatio) ||
    config.enableRatio <= 0 ||
    !Number.isFinite(config.disableRatio) ||
    config.enableRatio >= config.disableRatio ||
    ![config.memoryBudgetBytes, config.maxEvictionsPerSecond].every(
      (ceiling) => ceiling === undefined || (Number.isFinite(ceiling) && ceiling >= 0),
    )
  )
    throw new Error('INVALID_SAFETY_POLICY')
  let decision: SafetyDecision = {
      tier: 'baseline',
      enabled: false,
      reason: 'No comparable measured evidence',
      changedAt: 0,
      revision: 0,
    },
    good = 0,
    bad = 0,
    lastTime = -Infinity
  // Each reason belongs to one state (only the benefit reason is enabled): comparing reasons is enough.
  const transition = (enabled: boolean, reason: string, now: number) => {
    if (decision.reason !== reason)
      decision = {
        tier: enabled ? 'full' : 'baseline',
        enabled,
        reason,
        changedAt: now,
        revision: decision.revision + 1,
      }
    return decision
  }
  return {
    getDecision: () => decision,
    trip(reason: 'error' | 'oom' | 'device-lost' | 'thrashing' | 'quality-failed', now: number) {
      if (!Number.isFinite(now) || now < lastTime) throw new Error('INVALID_CLOCK')
      lastTime = now
      good = bad = 0
      return transition(false, `Circuit breaker: ${reason}`, now)
    },
    observe(reference: MeasuredCosts, candidate: MeasuredCosts, now: number) {
      if (!Number.isFinite(now) || now < lastTime) throw new Error('INVALID_CLOCK')
      lastTime = now
      const verdict = judgeEvidence(reference, candidate, config)
      if ('veto' in verdict) {
        good = bad = 0
        return transition(false, verdict.veto, now)
      }
      const { harmful, beneficial } = verdict
      bad = harmful ? bad + 1 : 0
      good = beneficial ? good + 1 : 0
      if (now - decision.changedAt < config.minimumPeriodMs) return decision
      if (decision.enabled && bad >= config.consecutiveViolations) {
        bad = good = 0
        return transition(false, 'Measured cost exceeds reference', now)
      }
      if (!decision.enabled && good >= config.minimumSamples) {
        bad = good = 0
        return transition(true, 'Measured benefit within configured budgets', now)
      }
      return decision
    },
  }
}
