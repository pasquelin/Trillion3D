// The table of an image's CPU bounds, alone: the timing state reads its names without the
// frame code that fills them.
import { cpuStepTable } from '../../../stage/cpuSteps.ts';

/**
 * CPU bounds of an image, in order: for each, its public name and the profile stage it deposits
 * into. Name, stage and write index all come from this one table. The first four cover what the
 * image does before opening its own timer; the four after encode are sampled by the host, which
 * deposits them by name. `tilesPumpMs` is the streamer's pass: an image whose feedback named no
 * tile writes `NaN` there, which the profiler drops, so the stage stays unmeasured rather than zero.
 * The six shadow bounds split the shadow work the encode bounds already hold: planning (the plan
 * around the scheduler, reading the request report, admitting pages) and encoding (the batches
 * around their regions and passes, each batch's regions, each batch's passes). They deposit on no
 * stage, which would count them a second time, and an image that ran no shadow step files `NaN`.
 */
const CPU = cpuStepTable([
  ['physicsMs', 'physics'],
  ['gateMs', 'animations'],
  ['tilesPumpMs', 'textures'],
  ['worldMs', 'animations'],
  ['blendWorldMs', 'transparents'],
  ['lightsMs', 'lights'],
  ['adoptCutMs', 'cutAdoption'],
  ['transparentSelectMs', 'transparents'],
  ['transparentPrepareMs', 'transparents'],
  ['transparentDrawMs', 'transparents'],
  ['transparentEncodeMs', null],
  ['admissionMs', 'residency'],
  ['residencyQueueMs', 'residency'],
  ['syncRowsMs', 'uploads'],
  ['residencyUploadMs', 'uploads'],
  ['selectionDispatchMs', 'selection'],
  ['partitionMs', 'partition'],
  ['encodeRestMs', 'encode'],
  ['queueSubmitMs', 'submit'],
  ['arrivalsMs', 'residency'],
  ['pendingMs', 'hostPages'],
  ['retainMs', 'hostPages'],
  ['submitMs', 'submit'],
  ['encodeSubmitMs', null],
  ['totalMs', null],
] as const);
export const CPU_STEP_NAMES = CPU.names;
export const CPU_STEP = CPU.at;
/** Stage of each bound, in profile-row order; `null` for a sum. */
export const CPU_STEP_STAGES = CPU.stages;
