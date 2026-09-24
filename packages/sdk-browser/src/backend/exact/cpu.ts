import { disabledStageProfile } from '../../../../sdk-core/src/index.ts';
import { createCpuStepProfile } from '../../stage/cpuProfile.ts';
import { createStageProfiler } from '../../stage/profiler.ts';
import { logFrameCostAudit } from '../../frame/costAudit.ts';
import { addCpuSteps, cpuStepTable } from '../../stage/cpuSteps.ts';
import { WEBGL_STAGES } from '../../stage/mapping.ts';
import type { BackendContext } from '../types.ts';
import type { HostCpuStep } from '../../host/cpuProfile.ts';

/**
 * CPU bounds of a WebGL2 frame, in order: its public name and the profile step it lands in
 * (`null` for the total, which does not land). `arrivals`, `pending`, `retain` and `submit`
 * are sampled by the host, which deposits them in `cpuStep` by name: the bound index in the
 * profile row never leaves this engine.
 */
const CPU = cpuStepTable([
  ['physicsMs', 'physics'],
  ['worldMs', 'animations'],
  ['lightsMs', 'lights'],
  ['selectMs', 'selection'],
  ['syncMs', 'uploads'],
  ['arrivalsMs', 'residency'],
  ['pendingMs', 'residency'],
  ['retainMs', 'residency'],
  ['submitMs', 'submit'],
  ['totalMs', null],
] as const);

/** Index of a bound in the profile row, for both files of this engine. */
export const EXACT_CPU_STEP = CPU.at;

export function createExactPagesCpu(
  onDiagnostic: BackendContext['onDiagnostic'],
  getFrame: () => number,
  enabled = false,
  getCutMs: () => number = () => 0,
) {
  // Per-step CPU profile, published in `summary` mode: turning on the per-frame trace would change the measurement.
  const cpuProfile = createCpuStepProfile(CPU.names);
  // The window a host opens with `resetStageProfile()` and reads once with `cpuSteps()`.
  const cpuWindow = createCpuStepProfile(CPU.names, { row: cpuProfile.row });
  const stages = enabled
    ? createStageProfiler({
        backend: 'exact-cluster-pages',
        stages: WEBGL_STAGES,
        gpuMethod: null,
        gpuReason: 'WebGL2 does not delimit a pass: only the whole frame is timeable',
      })
    : undefined;
  let cpuLogMs = 0,
    cpuLogFrame = -1;
  const methods = {
    /** GPU duration of the whole frame, sampled by the extension when it exists. */
    gpuImageMs(ms: number | null, supported: boolean, reason: string | null) {
      if (!stages) return;
      // The reason only accompanies a missing duration: a published measurement does not need one.
      stages.setGpuMethod(
        supported ? 'EXT_disjoint_timer_query_webgl2' : null,
        ms === null ? reason : null,
      );
      if (ms !== null) stages.pushImageGpu(ms);
    },
    resetStageProfile() {
      stages?.reset();
      cpuWindow.reset();
    },
    cpuSteps() {
      return cpuWindow.summary();
    },
    /** Public profile: "unmeasured" everywhere nothing was sampled, never a zero. */
    stageProfile() {
      return (
        stages?.profile() ??
        disabledStageProfile('exact-cluster-pages', 'per-step profile not requested by the host')
      );
    },
    /** Deposits the duration of a host-measured step: arrivals, wait, retention, submit. */
    cpuStep(step: HostCpuStep, ms: number) {
      cpuProfile.row[CPU.at[step]] = ms;
    },
    /** Closes the frame: total, ranking, and publication at most once every two seconds. */
    cpuFrameEnd() {
      const frame = getFrame();
      const row = cpuProfile.row;
      let total = 0;
      for (let i = 0; i < CPU.names.length - 1; i++) total += row[i];
      row[CPU.names.length - 1] = total;
      cpuProfile.record(frame, total);
      cpuWindow.record(frame, total);
      stages?.frameCpu((add) => {
        addCpuSteps(CPU.stages, row, add);
        // The hierarchical cut is bounded inside `selectMs` by the engine itself.
        add('hierarchyCut', getCutMs());
        add('frame', total);
      });
      const now = performance.now();
      if (now - cpuLogMs < 2000 || frame === cpuLogFrame) return;
      cpuLogMs = now;
      cpuLogFrame = frame;
      const steps = cpuProfile.summary();
      if (!steps) return;
      logFrameCostAudit('exact-cluster-pages', { kind: 'cpu-profile', frame, steps });
      try {
        onDiagnostic?.({
          phase: 'cpu-timing',
          message: 'CPU durations measured in the engine',
          context: {
            version: 1,
            engine: 'exact-cluster-pages',
            frame,
            scope: 'backend-render-and-host-draw',
            steps,
          },
        });
      } catch {
        /* Observers do not drive the render. */
      }
    },
  };
  return { profile: cpuProfile, methods };
}
