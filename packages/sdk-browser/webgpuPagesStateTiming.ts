import * as THREE from 'three';
import type { GpuPassTimings } from '../sdk-core/index.ts';
import type { createGpuTiming } from './gpuTiming.ts';
import type { SelectionSubmission } from './gpuSelection.ts';
import { createCpuStepProfile } from './cpuProfile.ts';
import type { WebgpuRunState } from './webgpuPagesStateRun.ts';
import type { WebgpuDiagnostics } from './webgpuPagesSetup.ts';

const CPU_STEPS = [
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
  'encodeSubmitMs',
  'totalMs',
] as const;

/** GPU pass timing, the CPU step profile of the image, and the one command buffer an image owns. */
export interface WebgpuTimingState {
  gpuTiming: ReturnType<typeof createGpuTiming> | undefined;
  lastGpuPassMs: GpuPassTimings | null;
  lastGpuFrameMs: number | null;
  lastGpuHostGapMs: number | null;
  lastSubmitMs: number | null;
  // Encode-side step durations of the current image, reported by the `cpu-timing` diagnostic.
  lastProjectMs: number;
  lastPartitionMs: number;
  lastItemsMs: number;
  cpuProfile: ReturnType<typeof createCpuStepProfile>;
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

export function createWebgpuTimingState(): WebgpuTimingState {
  return {
    gpuTiming: undefined,
    lastGpuPassMs: null,
    lastGpuFrameMs: null,
    lastGpuHostGapMs: null,
    lastSubmitMs: null,
    lastProjectMs: 0,
    lastPartitionMs: 0,
    lastItemsMs: 0,
    cpuProfile: createCpuStepProfile(CPU_STEPS),
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
