import * as THREE from 'three';
import type { GpuPassTimings } from '../sdk-core/index.ts';
import type { createGpuTiming } from './gpuTiming.ts';
import type { SelectionSubmission } from './gpuSelection.ts';
import { createCpuStepProfile } from './cpuProfile.ts';
import { createStageProfiler, type StageProfiler } from './stageProfiler.ts';
import { WEBGPU_STAGES } from './stageMapping.ts';
import type { WebgpuRunState } from './webgpuPagesStateRun.ts';
import type { WebgpuDiagnostics } from './webgpuPagesSetup.ts';

const CPU_STEPS = [
  'lightsMs',
  'adoptCutMs',
  'transparentSelectMs',
  'admissionMs',
  'residencyQueueMs',
  'syncRowsMs',
  'residencyUploadMs',
  'selectionDispatchMs',
  'projectBoxesMs',
  'partitionMs',
  'itemsMs',
  'encodeRestMs',
  'queueSubmitMs',
  'encodeSubmitMs',
  'totalMs',
] as const;
/** L'étape publique de chaque borne ci-dessus ; `null` pour les sommes, qui ne se déposent pas. */
export const CPU_STEP_STAGES: ReadonlyArray<string | null> = [
  'lights',
  'selection',
  'transparents',
  'residency',
  'residency',
  'uploads',
  'uploads',
  'selection',
  'encode',
  'encode',
  'encode',
  'encode',
  'submit',
  null,
  null,
];

/** GPU pass timing, the CPU step profile of the image, and the one command buffer an image owns. */
/** The timestamps of one GPU-cut image, written in place as each step ends. */
type GpuCutMarks = Record<
  | 'cpuStart'
  | 'lightsEnd'
  | 'adoptEnd'
  | 'transparentSelectEnd'
  | 'admissionEnd'
  | 'queueEnd'
  | 'rowsEnd'
  | 'residencyUploadEnd'
  | 'selectionEnd'
  | 'encodeStart'
  | 'cpuEnd',
  number
>;

export interface WebgpuTimingState {
  gpuTiming: ReturnType<typeof createGpuTiming> | undefined;
  lastGpuPassMs: GpuPassTimings | null;
  lastGpuFrameMs: number | null;
  lastGpuHostGapMs: number | null;
  lastSubmitMs: number | null;
  /** Durée du seul `queue.submit` de l'image : l'encodage ne la porte pas. */
  lastQueueSubmitMs: number;
  /** Profil par étape publié par `stageProfile()` ; absent quand l'hôte ne l'a pas demandé. */
  stages: StageProfiler | undefined;
  // Encode-side step durations of the current image, reported by the `cpu-timing` diagnostic.
  lastProjectMs: number;
  lastPartitionMs: number;
  lastItemsMs: number;
  cpuProfile: ReturnType<typeof createCpuStepProfile>;
  marks: GpuCutMarks;
  lastCpuLogMs: number;
  lastCpuLogFrame: number;
  cpuSample: Record<string, unknown> | undefined;
  transparentEncodeMs: number;
  /**
   * One image, one command buffer. A frame that drives the GPU cut opens it before the selection and
   * every pass it encodes lands in it, so the driver validates one buffer instead of two and the
   * enclosing GPU span has no host gap left to hold. The buffer the image drops must be settled, not
   * merely forgotten: the selection's readback copy would never run and its slot would stay mapped.
   */
  frameEncoder: GPUCommandEncoder | undefined;
  frameSelection: SelectionSubmission | undefined;
}

/** Le profil par étape du moteur WebGPU, monté seulement quand l'hôte l'a demandé. */
export function createWebgpuStageProfiler(): StageProfiler {
  const stages = createStageProfiler({
    backend: 'webgpu-page-raster',
    stages: WEBGPU_STAGES,
    gpuMethod: 'timestamp-query',
  });
  stages.setReason('coplanar', {
    cpu: 'décidées par la coupe, sans borne propre',
    gpu: 'dessinées dans les passes de géométrie, sans passe propre',
  });
  return stages;
}

export function createWebgpuTimingState(stages?: StageProfiler): WebgpuTimingState {
  return {
    gpuTiming: undefined,
    lastGpuPassMs: null,
    lastGpuFrameMs: null,
    lastGpuHostGapMs: null,
    lastSubmitMs: null,
    lastQueueSubmitMs: 0,
    stages,
    lastProjectMs: 0,
    lastPartitionMs: 0,
    lastItemsMs: 0,
    cpuProfile: createCpuStepProfile(CPU_STEPS),
    marks: {
      cpuStart: 0,
      lightsEnd: 0,
      adoptEnd: 0,
      transparentSelectEnd: 0,
      admissionEnd: 0,
      queueEnd: 0,
      rowsEnd: 0,
      residencyUploadEnd: 0,
      selectionEnd: 0,
      encodeStart: 0,
      cpuEnd: 0,
    },
    lastCpuLogMs: 0,
    lastCpuLogFrame: -1,
    cpuSample: undefined,
    transparentEncodeMs: 0,
    frameEncoder: undefined,
    frameSelection: undefined,
  };
}

/**
 * Publishes where the image's CPU time went, on the cadence of the progress diagnostic. It is called
 * by both render paths: a measured loop renders without ever flushing, and the profile is exactly what
 * such a loop needs.
 */
export function publishCpuProfile(
  timing: WebgpuTimingState,
  run: WebgpuRunState,
  diag: WebgpuDiagnostics,
) {
  if (diag.traceEnabled || !timing.cpuSample || run.frame === timing.lastCpuLogFrame) return;
  const now = performance.now();
  if (now - timing.lastCpuLogMs < 2000) return;
  timing.lastCpuLogMs = now;
  timing.lastCpuLogFrame = run.frame;
  diag.engineDiagnostic('cpu-timing', 'Durées CPU mesurées dans le moteur', {
    ...timing.cpuSample,
    steps: timing.cpuProfile.summary(),
  });
}

export const cameraPose = (camera: THREE.PerspectiveCamera) => ({
  position: camera.getWorldPosition(new THREE.Vector3()).toArray(),
  quaternion: camera.getWorldQuaternion(new THREE.Quaternion()).toArray(),
});
