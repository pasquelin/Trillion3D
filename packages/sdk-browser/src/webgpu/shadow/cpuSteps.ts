// The shadow bounds of the image's CPU steps (`../pages/render/cpuStepTable.ts`): written into the
// same profile row as every other bound, never a second profiler, and read back per frame.
import { CPU_STEP, SHADOW_CPU_STEPS, type ShadowCpuStep } from '../pages/render/cpuStepTable.ts';

/** What `recordShadowPlan` reads: the row, and what the scheduler spent inside its plan. */
type PlanSource = {
  timing: { cpuProfile: { row: Float64Array } };
  lights: { plan: { spent: { requestsMs: number; admissionMs: number } } };
};

/** An image opens with no shadow bound: a step it does not run reads `NaN`, never zero. */
export function forgetShadowCpuSteps(row: Float64Array) {
  for (const step of SHADOW_CPU_STEPS) row[CPU_STEP[step]] = NaN;
}

/**
 * Files the image's shadow planning, `totalMs` long: reading the request report and admitting
 * pages as the scheduler timed them, the plan the rest. A plan that stopped before the scheduler
 * files those two as `NaN`; what it read is consumed, so no later plan files it again.
 */
export function recordShadowPlan({ timing, lights }: PlanSource, totalMs: number) {
  const row = timing.cpuProfile.row,
    spent = lights.plan.spent;
  row[CPU_STEP.shadowRequestsMs] = spent.requestsMs;
  row[CPU_STEP.shadowAdmissionMs] = spent.admissionMs;
  row[CPU_STEP.shadowPlanMs] = totalMs - (spent.requestsMs || 0) - (spent.admissionMs || 0);
  spent.requestsMs = NaN;
  spent.admissionMs = NaN;
}

/** Files the image's shadow encoding: every batch `totalMs`, of which regions and passes. */
export function recordShadowEncoding(
  row: Float64Array,
  totalMs: number,
  regionsMs: number,
  passesMs: number,
) {
  row[CPU_STEP.shadowRegionsMs] = regionsMs;
  row[CPU_STEP.shadowPassesMs] = passesMs;
  row[CPU_STEP.shadowBatchesMs] = totalMs - regionsMs - passesMs;
}

const msOf = (row: ArrayLike<number>, step: ShadowCpuStep) => {
  const ms = row[CPU_STEP[step]];
  return Number.isFinite(ms) ? ms : null;
};

/** The frame metrics of the shadow bounds (`ShadowFrameMetrics`): `null` for a step not run. */
export function shadowCpuMetrics(row: ArrayLike<number>) {
  return {
    cpuShadowPlanMs: msOf(row, 'shadowPlanMs'),
    cpuShadowRequestsMs: msOf(row, 'shadowRequestsMs'),
    cpuShadowAdmissionMs: msOf(row, 'shadowAdmissionMs'),
    cpuShadowBatchesMs: msOf(row, 'shadowBatchesMs'),
    cpuShadowRegionsMs: msOf(row, 'shadowRegionsMs'),
    cpuShadowPassesMs: msOf(row, 'shadowPassesMs'),
  };
}
