import type { GpuPassTimings } from '../sdk-core/index.ts';
import type { createGpuTiming } from './gpuTiming.ts';
import type { SelectionSubmission } from './gpuSelection.ts';
import { createCpuStepProfile } from './cpuProfile.ts';
import { CPU_STEP_NAMES } from './webgpuPagesCpuSteps.ts';
import { createStageProfiler, type StageProfiler } from './stageProfiler.ts';
import { WEBGPU_STAGES } from './stageMapping.ts';

/** GPU pass timing, the CPU step profile of the image, and the one command buffer an image owns. */
/** The timestamps of one GPU-cut image, written in place as each step ends. */
type GpuCutMarks = Record<
  | 'preStart'
  | 'blendStart'
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
  /** Duration of the image's only `queue.submit`: encode does not carry it. */
  lastQueueSubmitMs: number;
  /** Per-stage profile published by `stageProfile()`; absent when the host has not asked for it. */
  stages: StageProfiler | undefined;
  // Encode-side step durations of the current image, reported by the `cpu-timing` diagnostic.
  /** What encoding the partition cost the CPU: the corners the table just changed, one view-projection
   *  matrix, and three compute dispatches. Never a row. */
  lastPartitionMs: number;
  /** What the image's partition decided: counts, never durations. */
  partitionCounts: {
    lignes: number;
    occulteurs: number;
    testees: number;
    /** Boxes that do not cut the near plane, therefore shareable by depth. */
    bornesToutes: number;
    historiqueOcculteurs: number;
    sansHistorique: number;
    /** Image these counts describe: they are written by the GPU and reread periodically, therefore
     *  never those of the current image. `-1` until a sample has come back. */
    imageRelevee: number;
  };
  /** What encode uploaded and submitted: counts, never durations. */
  encodeCounts: {
    lignesTeleversees: number;
    fichesTeleversees: number;
    appelsDeDessin: number;
    appelsDeMelange: number;
    /** Compute-raster dispatches, counted separately: they are not draw calls. */
    lancementsDeCalcul: number;
  };
  cpuProfile: ReturnType<typeof createCpuStepProfile>;
  /** True when the image has filled its bound row and waits to be filed by the host. */
  rowFilled: boolean;
  marks: GpuCutMarks;
  lastCpuLogMs: number;
  lastCpuLogFrame: number;
  cpuSample: Record<string, unknown> | undefined;
  transparentEncodeMs: number;
  transparentSelectMs: number;
  transparentPrepareMs: number;
  transparentDrawMs: number;
  transparentSpanUploadBytes: number;
  /**
   * One image, one command buffer. A frame that drives the GPU cut opens it before the selection and
   * every pass it encodes lands in it, so the driver validates one buffer instead of two and the
   * enclosing GPU span has no host gap left to hold. The buffer the image drops must be settled, not
   * merely forgotten: the selection's readback copy would never run and its slot would stay mapped.
   */
  frameEncoder: GPUCommandEncoder | undefined;
  frameSelection: SelectionSubmission | undefined;
}

/** Per-stage profile of the WebGPU engine, mounted only when the host has asked for it. */
export function createWebgpuStageProfiler(): StageProfiler {
  const stages = createStageProfiler({
    backend: 'webgpu-page-raster',
    stages: WEBGPU_STAGES,
    gpuMethod: 'timestamp-query',
  });
  stages.setReason('coplanar', {
    cpu: 'decided by the cut, with no bound of their own',
    gpu: 'drawn in the geometry passes, with no pass of their own',
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
    lastPartitionMs: 0,
    partitionCounts: {
      lignes: 0,
      occulteurs: 0,
      testees: 0,
      bornesToutes: 0,
      historiqueOcculteurs: 0,
      sansHistorique: 0,
      imageRelevee: -1,
    },
    encodeCounts: {
      lignesTeleversees: 0,
      fichesTeleversees: 0,
      appelsDeDessin: 0,
      appelsDeMelange: 0,
      lancementsDeCalcul: 0,
    },
    cpuProfile: createCpuStepProfile(CPU_STEP_NAMES),
    rowFilled: false,
    marks: {
      preStart: 0,
      blendStart: 0,
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
    transparentSelectMs: 0,
    transparentPrepareMs: 0,
    transparentDrawMs: 0,
    transparentSpanUploadBytes: 0,
    frameEncoder: undefined,
    frameSelection: undefined,
  };
}
