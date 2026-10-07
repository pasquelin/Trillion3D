import type { GpuPassTimings } from '../../../../../sdk-core/src/index.ts'
import type { createGpuTiming } from '../../../gpu/timing/timing.ts'
import type { SelectionSubmission } from '../../../gpu/core/selection.ts'
import { createCpuStepProfile } from '../../../stage/cpuProfile.ts'
import { CPU_STEP_NAMES } from '../render/cpuStepTable.ts'
import { createStageProfiler, type StageProfiler } from '../../../stage/profiler.ts'
import { WEBGPU_STAGES } from '../../../stage/mapping.ts'
import { WEBGPU_ENGINE_ID } from '../../../engine/factory.ts'

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
  /** Per-stage profile published by `stageProfile()`; absent when the host has not asked for it. */
  stages: StageProfiler | undefined
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
  /** What the world step walks: counts, never durations. `roots` is how many root matrices one
   *  rebase brings back to the eye, the layout's roots; `rootsRebased` is how many this image
   *  did — all of them when the camera or the scene moved, none otherwise, so a held or still image
   *  reports zero. */
  worldCounts: { roots: number; rootsRebased: number }
  /** What encode uploaded and submitted: counts, never durations. */
  encodeCounts: {
    rowsUploaded: number
    itemsUploaded: number
    drawCalls: number
    blendDrawCalls: number
    /** Compute-raster dispatches, counted separately: they are not draw calls. */
    computeDispatches: number
  }
  /** CPU bounds of the last images, on the publish cadence of the `cpu-timing` diagnostic. */
  cpuProfile: ReturnType<typeof createCpuStepProfile>
  /** The same bounds over the window a host opens with `resetStageProfile()` and reads once with
   *  `cpuSteps()`: the same row, filed twice, so neither window forgets for the other. */
  cpuWindow: ReturnType<typeof createCpuStepProfile>
  /** True when the image has filled its bound row and waits to be filed by the host. */
  rowFilled: boolean
  marks: GpuCutMarks
  lastCpuLogMs: number
  lastCpuLogFrame: number
  cpuSample: Record<string, unknown> | undefined
  transparentEncodeMs: number
  transparentSelectMs: number
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

/** Per-stage profile of the WebGPU engine, mounted only when the host has asked for it. */
export function createWebgpuStageProfiler(): StageProfiler {
  const stages = createStageProfiler({
    backend: WEBGPU_ENGINE_ID,
    stages: WEBGPU_STAGES,
    gpuMethod: 'timestamp-query',
  })
  stages.setReason('coplanar', {
    cpu: 'decided by the cut, with no bound of their own',
    gpu: 'drawn in the geometry passes, with no pass of their own',
  })
  return stages
}

export function createWebgpuTimingState(
  stages?: StageProfiler,
  roots: () => number = () => 0,
): WebgpuTimingState {
  const cpuProfile = createCpuStepProfile(CPU_STEP_NAMES)
  return {
    gpuTiming: undefined,
    lastGpuPassMs: null,
    lastGpuFrameMs: null,
    lastGpuHostGapMs: null,
    lastGpuIdleMs: null,
    lastSubmitMs: null,
    logFrame: undefined,
    lastQueueSubmitMs: 0,
    stages,
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
      rootsRebased: 0,
    },
    encodeCounts: {
      rowsUploaded: 0,
      itemsUploaded: 0,
      drawCalls: 0,
      blendDrawCalls: 0,
      computeDispatches: 0,
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
  }
}
