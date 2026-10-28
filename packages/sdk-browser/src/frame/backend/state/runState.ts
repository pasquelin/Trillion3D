import { createSelectionUniforms } from '../../../gpu/core/selection.ts'
import { createRankList } from '../../../geometry/cut/adoption/copyRanks.ts'
import { createFrameGateCore } from '../../gate/gateCore.ts'
import { HOLD_SIGNATURE_VALUES } from '../../loop/signature.ts'
import { createWebgpuBudgetState } from '../../../geometry/residency/budgetState.ts'
import { RASTER_BACKGROUND } from '../../../geometry/pages/raster.ts'
import { newGraphClocks } from '../../../materials/graph/clocks.ts'
import { SHADING } from '../../../materials/surface/pixelModel.ts'
import type { WebgpuRunState } from './run.ts'
import { createChangedRuns } from '../../../geometry/residency/ranges.ts'

/** The frame's counters and what the last image showed. */
function runCounters(
  clearColor: number,
): Pick<
  WebgpuRunState,
  | 'clearColor'
  | 'lost'
  | 'overBudget'
  | 'visible'
  | 'selectedTriangles'
  | 'submittedTriangles'
  | 'frustumRejected'
  | 'lodLevel'
  | 'occluded'
  | 'postHidden'
  | 'frame'
  | 'imageRevision'
  | 'diagnostic'
  | 'diagnosticPixelError'
  | 'lastCamera'
  | 'gpuSelection'
  | 'hizPyramidFresh'
  | 'depthDrawn'
  | 'gpuMetricsReady'
> {
  return {
    clearColor,
    lost: false,
    overBudget: false,
    visible: 0,
    selectedTriangles: 0,
    submittedTriangles: 0,
    frustumRejected: 0,
    lodLevel: 0,
    occluded: 0,
    postHidden: 0,
    frame: 0,
    imageRevision: 0,
    diagnostic: 'beauty',
    diagnosticPixelError: 0,
    lastCamera: undefined,
    gpuSelection: undefined,
    hizPyramidFresh: false,
    depthDrawn: false,
    gpuMetricsReady: false,
  }
}

/** The draw counts of the image and the flags of what it logged. */
function runDraws(): Pick<
  WebgpuRunState,
  | 'deferredDrops'
  | 'blendPagedTriangles'
  | 'blendSubmittedTriangles'
  | 'blendDrawCalls'
  | 'blendFrustumRejected'
  | 'gpuDrawCalls'
  | 'gpuComputeDispatches'
  | 'lastProgressMs'
  | 'renderPathLogged'
  | 'outputDiagnosticLogged'
  | 'noOccluderHistory'
  | 'clustersSyncedFrame'
  | 'selectionUniforms'
  | 'asideCut'
> {
  return {
    deferredDrops: new Set(),
    blendPagedTriangles: 0,
    blendSubmittedTriangles: 0,
    blendDrawCalls: 0,
    blendFrustumRejected: 0,
    gpuDrawCalls: 0,
    gpuComputeDispatches: 0,
    lastProgressMs: 0,
    renderPathLogged: false,
    outputDiagnosticLogged: false,
    noOccluderHistory: true,
    clustersSyncedFrame: -1,
    selectionUniforms: createSelectionUniforms(),
    asideCut: undefined,
  }
}

/** The pages the cut shows and wants, and the scratch lists beside them. */
function runPages(): Pick<WebgpuRunState, 'shown' | 'shownPacked' | 'desired' | 'desiredPacked'> {
  return {
    shown: [],
    shownPacked: createRankList(),
    desired: [],
    desiredPacked: createRankList(),
  }
}

/** The pages entering and leaving the cut, its scratch lists and the epochs it holds. */
function runCut(): Pick<
  WebgpuRunState,
  | 'pagesEntered'
  | 'pagesExited'
  | 'pendingScratch'
  | 'awaitedScratch'
  | 'hostPendingScratch'
  | 'cutHeld'
  | 'cutEpoch'
  | 'pageArrayEpoch'
  | 'pendingHeld'
> {
  return {
    pagesEntered: null,
    pagesExited: null,
    pendingScratch: [],
    awaitedScratch: [],
    hostPendingScratch: [],
    cutHeld: false,
    cutEpoch: 0,
    pageArrayEpoch: 0,
    pendingHeld: { epoch: -1, cut: -1, limited: false, ready: false, accepted: -1 },
  }
}

/** The frame gate, the first image's hold, the GPU frames in flight and the world upload. */
function runLoop(): Pick<
  WebgpuRunState,
  | 'ranksHeld'
  | 'gate'
  | 'graphClocks'
  | 'shading'
  | 'frameHeld'
  | 'heldEmpty'
  | 'imageWithheld'
  | 'initialLoad'
  | 'streamingBlocks'
  | 'gpuFramesInFlight'
  | 'submittedDone'
  | 'submittedAt'
  | 'textureConverging'
  | 'feedbackWritten'
  | 'worldUploadRevision'
  | 'movedWorlds'
  | 'funding'
> {
  return {
    ranksHeld: { epoch: -1, cut: -1, limited: false },
    gate: createFrameGateCore(HOLD_SIGNATURE_VALUES),
    graphClocks: newGraphClocks(),
    shading: new Float64Array(SHADING.length),
    frameHeld: false,
    heldEmpty: false,
    // No image is shown before the view has loaded (`../../loop/firstImage.ts`).
    imageWithheld: true,
    initialLoad: true,
    streamingBlocks: false,
    gpuFramesInFlight: 0,
    submittedDone: undefined,
    submittedAt: undefined,
    textureConverging: false,
    feedbackWritten: false,
    worldUploadRevision: 0,
    // No frame before the first image: it uploads, whatever happens.
    movedWorlds: createChangedRuns(),
    funding: {
      ledgerBytes: undefined,
      refreshing: undefined,
      cutAsked: 0,
      pending: Promise.resolve(),
    },
  }
}

export function createWebgpuRunState(clearColor = RASTER_BACKGROUND): WebgpuRunState {
  return {
    ...runCounters(clearColor),
    ...createWebgpuBudgetState(),
    ...runDraws(),
    ...runPages(),
    ...runCut(),
    ...runLoop(),
  }
}
