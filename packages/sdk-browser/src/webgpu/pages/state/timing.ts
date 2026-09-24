import type { GpuPassTimings } from '../../../../../sdk-core/src/index.ts';
import type { createGpuTiming } from '../../../gpu/timing/timing.ts';
import type { SelectionSubmission } from '../../../gpu/core/selection.ts';
import { createCpuStepProfile } from '../../../stage/cpuProfile.ts';
import { CPU_STEP_NAMES } from '../render/cpuSteps.ts';
import { createStageProfiler, type StageProfiler } from '../../../stage/profiler.ts';
import { WEBGPU_STAGES } from '../../../stage/mapping.ts';

/** GPU pass timing, the CPU step profile of the image, and the one command buffer an image owns. */
/** The timestamps of one GPU-cut image, written in place as each step ends. */
type GpuCutMarks = Record<
  | 'preStart'
  | 'gateEnd'
  | 'tilesEnd'
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
   *  matrix, and two compute dispatches. Never a row. */
  lastPartitionMs: number;
  /** What the image's partition decided: counts, never durations. */
  partitionCounts: {
    lignes: number;
    occulteurs: number;
    testees: number;
    /** Rows the previous image drew, before its pyramid withdrew some of them. */
    historiqueOcculteurs: number;
    /** Rows drawn last image that last image's pyramid sent to the tested half. */
    retiresParLaPyramide: number;
    /** Image these counts describe: they are written by the GPU and reread periodically, therefore
     *  never those of the current image. `-1` until a sample has come back. */
    imageRelevee: number;
  };
  /** What the world step walks: counts, never durations. `racines` is how many root matrices one
   *  rebase brings back to the eye, fixed with the layout; `racinesRebasees` is how many this image
   *  did — all of them when the camera or the scene moved, none otherwise, so a held or still image
   *  reports zero. */
  worldCounts: { racines: number; racinesRebasees: number };
  /** What encode uploaded and submitted: counts, never durations. */
  encodeCounts: {
    lignesTeleversees: number;
    fichesTeleversees: number;
    appelsDeDessin: number;
    appelsDeMelange: number;
    /** Compute-raster dispatches, counted separately: they are not draw calls. */
    lancementsDeCalcul: number;
  };
  /** CPU bounds of the last images, on the publish cadence of the `cpu-timing` diagnostic. */
  cpuProfile: ReturnType<typeof createCpuStepProfile>;
  /** The same bounds over the window a host opens with `resetStageProfile()` and reads once with
   *  `cpuSteps()`: the same row, filed twice, so neither window forgets for the other. */
  cpuWindow: ReturnType<typeof createCpuStepProfile>;
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
  /** Settlement of the light cuts' request readback, carried by the command buffer that copied it. */
  shadowRequests: SelectionSubmission | undefined;
  /** The light cut's flag word, copied with the frame's pages (`lightCutRedraws.ts`). */
  shadowRedraws: SelectionSubmission | undefined;
  /** Settlement of the shadow pages the resolve asked for, carried by the same command buffer. */
  shadowPageRequests: SelectionSubmission | undefined;
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

export function createWebgpuTimingState(stages?: StageProfiler, roots = 0): WebgpuTimingState {
  const cpuProfile = createCpuStepProfile(CPU_STEP_NAMES);
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
      historiqueOcculteurs: 0,
      retiresParLaPyramide: 0,
      imageRelevee: -1,
    },
    worldCounts: { racines: roots, racinesRebasees: 0 },
    encodeCounts: {
      lignesTeleversees: 0,
      fichesTeleversees: 0,
      appelsDeDessin: 0,
      appelsDeMelange: 0,
      lancementsDeCalcul: 0,
    },
    cpuProfile,
    cpuWindow: createCpuStepProfile(CPU_STEP_NAMES, { row: cpuProfile.row }),
    rowFilled: false,
    marks: {
      preStart: 0,
      gateEnd: 0,
      tilesEnd: 0,
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
    shadowRequests: undefined,
    shadowRedraws: undefined,
    shadowPageRequests: undefined,
  };
}
