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
  /** Durée du seul `queue.submit` de l'image : l'encodage ne la porte pas. */
  lastQueueSubmitMs: number;
  /** Profil par étape publié par `stageProfile()` ; absent quand l'hôte ne l'a pas demandé. */
  stages: StageProfiler | undefined;
  // Encode-side step durations of the current image, reported by the `cpu-timing` diagnostic.
  lastProjectMs: number;
  lastPartitionMs: number;
  lastItemsMs: number;
  /** Ce que la partition de l'image a décidé : des comptes, jamais des durées. */
  partitionCounts: {
    lignes: number;
    occulteurs: number;
    testees: number;
    bornesToutes: number;
    historiqueOcculteurs: number;
    sansHistorique: number;
  };
  /** Ce que l'encodage a téléversé et soumis : des comptes, jamais des durées. */
  encodeCounts: {
    lignesTeleversees: number;
    fichesTeleversees: number;
    appelsDeDessin: number;
    appelsDeMelange: number;
  };
  cpuProfile: ReturnType<typeof createCpuStepProfile>;
  /** Vrai quand l'image a rempli sa ligne de bornes et attend d'être classée par l'hôte. */
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
    partitionCounts: {
      lignes: 0,
      occulteurs: 0,
      testees: 0,
      bornesToutes: 0,
      historiqueOcculteurs: 0,
      sansHistorique: 0,
    },
    encodeCounts: {
      lignesTeleversees: 0,
      fichesTeleversees: 0,
      appelsDeDessin: 0,
      appelsDeMelange: 0,
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
