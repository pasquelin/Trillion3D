import type { GpuPassTimings } from '../../../../../sdk-core/src/index.ts'
import type { createGpuTiming } from '../../../gpu/timing/timing.ts'
import type { SelectionSubmission } from '../../../gpu/core/selection.ts'
import { CPU_STEP_NAMES, CPU_STEP_STAGES } from '../render/cpuStepTable.ts'
import {
  createStageProfiler,
  type CpuStepWindow,
  type StageProfiler,
} from '../../../stage/profiler.ts'
import type { WEBGPU_STAGES } from '../../../stage/passDeclaration.ts'
import { WEBGPU_ENGINE_ID } from '../../../engine/factory.ts'

/** GPU pass timing, the CPU step profile of the image, and the one command buffer an image owns. */
/** The timestamps of one GPU-cut image, written in place as each step ends. */
type GpuCutMarks = Record<
  | 'preStart'
  | 'gateEnd'
  | 'tilesEnd'
  | 'blendStart'
  | 'cpuStart'
  | 'adoptEnd'
  | 'admissionEnd'
  | 'queueEnd'
  | 'rowsEnd'
  | 'residencyUploadEnd'
  | 'selectionEnd'
  | 'encodeStart'
  | 'cpuEnd',
  number
>

export interface WebgpuTimingState {
  gpuTiming: ReturnType<typeof createGpuTiming> | undefined
  lastGpuPassMs: GpuPassTimings | null
  lastGpuFrameMs: number | null
  lastGpuHostGapMs: number | null
  /** The last sample's device idle since the image before it (`idleBetweenMs`); `null`
   *  when that sample had no neighbour to measure from. */
  lastGpuIdleMs: number | null
  lastSubmitMs: number | null
  /** The GPU log's per-image feed (`prepare/gpuLog.ts`); absent until the timer is prepared. */
  logFrame: ((cpuMs: number, rafMs: number | null) => void) | undefined
  /** Duration of the image's only `queue.submit`: encode does not carry it. */
  lastQueueSubmitMs: number
  /** The image's CPU bounds, and the per-stage profile published by `stageProfile()` when the host
   *  has asked for it (`profiler.stages`). */
  profiler: StageProfiler
  /** The bounds' window the engine's CPU diagnostic reads on its cadence. */
  publishedSteps: CpuStepWindow
  /** The bounds' window the host opens again (`resetStageProfile`) and reads (`cpuSteps`). */
  hostSteps: CpuStepWindow
  // Encode-side step durations of the current image, reported by the `cpu-timing` diagnostic.
  /** What encoding the partition cost the CPU: the corners the table just changed, one view-projection
   *  matrix, and two compute dispatches. Never a row. */
  lastPartitionMs: number
  /** What the image's partition decided: counts, never durations. */
  partitionCounts: {
    rows: number
    occluders: number
    tested: number
    /** Rows the previous image drew, before its pyramid withdrew some of them. */
    previousOccluders: number
    /** Rows drawn last image that last image's pyramid sent to the tested half. */
    pyramidWithdrawn: number
    /** Image these counts describe: they are written by the GPU and reread periodically, therefore
     *  never those of the current image. `-1` until a sample has come back. */
    sampledFrame: number
  }
  /** What the world step walks: counts, never durations. `roots` is the layout's roots;
   *  `rootsUploaded` how many root worlds this image sent — those a call named, every one after a
   *  host walk, none otherwise, so a held or still image, a moving camera's included, reports
   *  zero. */
  worldCounts: { roots: number; rootsUploaded: number }
  /** What encode uploaded and submitted: counts, never durations. */
  encodeCounts: {
    rowsUploaded: number
    itemsUploaded: number
    drawCalls: number
    blendDrawCalls: number
    /** Compute-raster dispatches, counted separately: they are not draw calls. */
    computeDispatches: number
  }
  /** True when the image has filled its bound row and waits to be filed by the host. */
  rowFilled: boolean
  marks: GpuCutMarks
  lastCpuLogMs: number
  lastCpuLogFrame: number
  cpuSample: Record<string, unknown> | undefined
  transparentEncodeMs: number
  transparentPrepareMs: number
  transparentDrawMs: number
  transparentSpanUploadBytes: number
  /**
   * One image, one command buffer. A frame that drives the GPU cut opens it before the selection and
   * every pass it encodes lands in it, so the driver validates one buffer instead of two and the
   * enclosing GPU span has no host gap left to hold. The buffer the image drops must be settled, not
   * merely forgotten: the selection's readback copy would never run and its slot would stay mapped.
   */
  frameEncoder: GPUCommandEncoder | undefined
  frameSelection: SelectionSubmission | undefined
}

/** Profile of the WebGPU engine; its per-stage profile is mounted on `stages` only when the host
 *  has asked for it. */
function createWebgpuProfiler(stages: typeof WEBGPU_STAGES | undefined): StageProfiler {
  const profiler = createStageProfiler({
    backend: WEBGPU_ENGINE_ID,
    steps: { names: CPU_STEP_NAMES, stages: CPU_STEP_STAGES },
    stages,
    gpuMethod: 'timestamp-query',
  })
  profiler.stages?.setReason('coplanar', {
    cpu: 'decided by the cut, with no bound of their own',
    gpu: 'drawn in the geometry passes, with no pass of their own',
  })
  return profiler
}

export function createWebgpuTimingState(
  stages?: typeof WEBGPU_STAGES,
  roots: () => number = () => 0,
): WebgpuTimingState {
  const profiler = createWebgpuProfiler(stages)
  return {
    gpuTiming: undefined,
    lastGpuPassMs: null,
    lastGpuFrameMs: null,
    lastGpuHostGapMs: null,
    lastGpuIdleMs: null,
    lastSubmitMs: null,
    logFrame: undefined,
    lastQueueSubmitMs: 0,
    profiler,
    publishedSteps: profiler.openWindow(),
    hostSteps: profiler.openWindow(),
    lastPartitionMs: 0,
    partitionCounts: {
      rows: 0,
      occluders: 0,
      tested: 0,
      previousOccluders: 0,
      pyramidWithdrawn: 0,
      sampledFrame: -1,
    },
    // Read live, never a count kept beside the roots.
    worldCounts: {
      get roots() {
        return roots()
      },
      rootsUploaded: 0,
    },
    encodeCounts: {
      rowsUploaded: 0,
      itemsUploaded: 0,
      drawCalls: 0,
      blendDrawCalls: 0,
      computeDispatches: 0,
    },
    rowFilled: false,
    marks: {
      preStart: 0,
      gateEnd: 0,
      tilesEnd: 0,
      blendStart: 0,
      cpuStart: 0,
      adoptEnd: 0,
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
    transparentPrepareMs: 0,
    transparentDrawMs: 0,
    transparentSpanUploadBytes: 0,
    frameEncoder: undefined,
    frameSelection: undefined,
  }
}
