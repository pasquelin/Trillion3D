import { createSelectionUniforms } from '../../../gpu/core/selection.ts'
import { unmirroredDrawn } from '../helpers.ts'
import { createFrameGateCore } from '../../gate/gateCore.ts'
import { HOLD_SIGNATURE_VALUES } from '../../loop/signature.ts'
import { createWebgpuBudgetState } from '../../../geometry/residency/budgetState.ts'
import { RASTER_BACKGROUND } from '../../../geometry/pages/raster.ts'
import type { WebgpuRunState } from './run.ts'
import { createChangedRuns } from '../../../geometry/residency/ranges.ts'

export function createWebgpuRunState(clearColor = RASTER_BACKGROUND): WebgpuRunState {
  return {
    clearColor,
    lost: false,
    overBudget: false,
    visible: 0,
    selectedTriangles: 0,
    submittedTriangles: 0,
    frustumRejected: 0,
    lodLevel: 0,
    frame: 0,
    imageRevision: 0,
    diagnostic: 'beauty',
    diagnosticPixelError: 0,
    lastCamera: undefined,
    gpuSelection: undefined,
    hizPyramidFresh: false,
    depthDrawn: false,
    gpuMetricsReady: false,
    ...createWebgpuBudgetState(),
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
    rowsSyncedFrame: -1,
    motion: {},
    selectionUniforms: createSelectionUniforms(),
    asideCut: undefined,
    shown: [],
    shownPacked: [],
    desired: [],
    desiredPacked: [],
    drawn: [],
    drawnPacked: [],
    ...unmirroredDrawn(),
    pagesEntered: null,
    pagesExited: null,
    pendingScratch: [],
    awaitedScratch: [],
    hostPendingScratch: [],
    cutHeld: false,
    cutEpoch: 0,
    pageArrayEpoch: 0,
    pendingHeld: { epoch: -1, cut: -1, limited: false, ready: false },
    ranksHeld: { epoch: -1, cut: -1, limited: false },
    gate: createFrameGateCore(HOLD_SIGNATURE_VALUES),
    frameHeld: false,
    gpuFramesInFlight: 0,
    textureConverging: false,
    feedbackWritten: false,
    worldUploadRevision: 0,
    // No frame before the first image: it uploads, whatever happens.
    movedWorlds: createChangedRuns(),
    occluderSignature: 0,
    funding: {
      ledgerBytes: undefined,
      refreshing: undefined,
      cutAsked: 0,
      pending: Promise.resolve(),
    },
  }
}
