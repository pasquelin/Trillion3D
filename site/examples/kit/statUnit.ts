import type { CpuSteps, ProfiledWorld } from './profile.ts';

/**
 * The CPU stages of a frame as the corner names them, the reference engine's `stat unit` beside its Insights:
 * each the engine steps it sums (`packages/sdk-browser/src/webgpu/pages/render/cpuStepTable.ts`).
 * Shadow planning is a part of the command encoding, named apart as the stage most often to blame.
 */
export const CPU_STAGES = [
  ['cut and culling', ['adoptCutMs', 'selectionDispatchMs', 'partitionMs']],
  [
    'page preparation',
    [
      'admissionMs',
      'residencyQueueMs',
      'syncRowsMs',
      'residencyUploadMs',
      'arrivalsMs',
      'pendingMs',
      'retainMs',
    ],
  ],
  ['shadow planning', ['shadowPlanMs', 'shadowRequestsMs', 'shadowAdmissionMs']],
  ['command encoding', ['encodeRestMs']],
  ['physics step', ['physicsMs']],
] as const;

/**
 * Each CPU stage of the engine's step window, in the order of `CPU_STAGES`: the sum of its steps'
 * medians, a stage none of whose steps ran left out. `null` from an engine with no step window
 * (WebGL2).
 */
export function cpuStages(engine: CpuSteps | null): [string, number][] | null {
  if (!engine) return null;
  const stages: [string, number][] = [];
  for (const [name, steps] of CPU_STAGES) {
    const medians = steps
      .map((step) => engine.steps[step]?.p50)
      .filter((p50): p50 is number => Number.isFinite(p50));
    if (medians.length) stages.push([name, medians.reduce((sum, p50) => sum + p50, 0)]);
  }
  return stages;
}

/** The world's CPU stages since the last read (`cpuStages`); the engine's window opens again. */
export function engineStages(world: ProfiledWorld): [string, number][] | null {
  const engine = world.cpuSteps?.() ?? null;
  world.resetCpuSteps?.();
  return cpuStages(engine);
}
