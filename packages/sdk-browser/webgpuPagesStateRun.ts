import type { CameraMotion, EngineCamera, HostCamera } from './cameraWorld.ts';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import { createSelectionResult, type PageRec, type SelectionResult } from './pageSelection.ts';
import {
  createSelectionUniforms,
  type GpuSelection,
  type SelectionUniforms,
} from './gpuSelection.ts';
import { createHizCounts, type HizCounts, type TemporalHizState } from './hiz.ts';
import { unmirroredDrawn } from './webgpuPagesHelpers.ts';
import { createFrameGateCore, type FrameGateCore } from './frameGateCore.ts';
import { HOLD_SIGNATURE_VALUES } from './webgpuFrameSignature.ts';

/** What the current image decided and counted: the cut, the coverage budget, the metrics the host
 *  reads, and the occlusion history the next image inherits. */
export interface WebgpuRunState {
  lost: boolean;
  overBudget: boolean;
  visible: number;
  selectedTriangles: number;
  submittedTriangles: number;
  uncoveredTriangles: number;
  frustumRejected: number;
  lodLevel: number;
  frame: number;
  imageRevision: number;
  diagnostic: DiagnosticMode;
  diagnosticPixelError: number;
  lastCamera: HostCamera | undefined;
  gpuSelection: GpuSelection | undefined;
  gpuFrameActive: boolean;
  /** True when the Hi-Z pyramid was built in the current submission: the transparent occlusion test
   *  never strips a pyramid of another image. */
  hizPyramidFresh: boolean;
  gpuMetricsReady: boolean;
  coverageBudgetLimited: boolean;
  /** Screen-error floor the GPU page budget imposes on the cut; 0 when the requested detail fits. */
  budgetPixelError: number;
  coverageBudgetEvent: Record<string, unknown> | undefined;
  deferredDrops: Set<string>;
  /** Triangles of the transparent clusters the cut holds, counted once whatever the pass count. */
  blendPagedTriangles: number;
  /** Triangles of the transparent meshes outside the cluster DAG, counted per draw. */
  blendUnpagedTriangles: number;
  blendSubmittedTriangles: number;
  blendDrawCalls: number;
  /** Cut triangles the current image puts back to draw: the published cut minus clusters without a
   *  residency row. Counted without waiting for the GPU, held from one image to the next like the cut. */
  drawnTriangles: number;
  blendFrustumRejected: number;
  gpuDrawCalls: number;
  /** Compute dispatches of the image: the opaque raster is not a draw call. */
  gpuComputeDispatches: number;
  lastProgressMs: number;
  renderPathLogged: boolean;
  outputDiagnosticLogged: boolean;
  noOccluderHistory: boolean;
  /** True on an image whose view differs from the previous one's: the GPU partition then lets
   *  every row be withdrawn from the occluders again. */
  hizViewMoved: boolean;
  previousHizView: EngineCamera | undefined;
  temporalHizState: TemporalHizState;
  /** Counters of the CPU occlusion oracle, which runs only where the GPU test does not. */
  cpuHizCounts: HizCounts;
  cpuHizCounted: boolean;
  rowsSyncedFrame: number;
  motion: CameraMotion;
  selectionUniforms: SelectionUniforms;
  /** Result of the CPU cut, reused image after image so the cut allocates nothing. */
  selectResult: SelectionResult<PageRec>;
  /** Time of the CPU cut alone; null on an image the GPU cut decided. */
  cpuSelectMs: number | null;
  shown: PageRec[];
  desired: PageRec[];
  drawn: PageRec[];
  /** True when `drawn` copies `shown` as-is; written only by the copies in `webgpuPagesHelpers.ts`. */
  drawnMirrorsShown: boolean;
  /** Pages the residency path had to touch this image; null before a GPU cut reported one. */
  pagesEntered: number | null;
  pagesExited: number | null;
  // Reused by the cut every image; the cut changes, the arrays behind it do not.
  opaqueScratch: PageRec[];
  transparentScratch: PageRec[];
  culledScratch: PageRec[];
  readyScratch: PageRec[];
  pendingScratch: string[];
  /** Array of the list returned to the host, for it alone: render tracking writes into the other, and
   *  a list held from one image to the next would not survive that sharing. */
  hostPendingScratch: string[];
  urlScratch: string[];
  /** True when adoption reread the sample already held: `desired` and `shown` have not moved. */
  cutHeld: boolean;
  /** Age of the cut's lists: rises as soon as an adoption or the CPU cut rewrites them, rendered or
   *  not. What a keeper of a list from one image to the next reads. */
  cutEpoch: number;
  /** Rises every time a page receives or loses its bytes: what the waited-for list reads. */
  pageArrayEpoch: number;
  /** What each list returned to the host describes: the state that produced it, or `-1` if it is to
   *  be remade. A list is kept only if everything it depends on is still that one. */
  pendingHeld: { epoch: number; cut: number; limited: boolean; ready: boolean };
  urlsHeld: { epoch: number; cut: number; limited: boolean };
  ranksHeld: { epoch: number; cut: number; limited: boolean };
  /** URL sets of an image: filled then emptied, never reallocated. */
  requestedScratch: Set<string>;
  transitionScratch: Set<string>;
  /** Image entry: revisions, view origin, reread of the source graph, walk of world matrices and
   *  held-image witness. See `frameGateCore.ts`. */
  gate: FrameGateCore;
  /** True when the current image was held: no CPU step was executed. */
  frameHeld: boolean;
  /** A barrier converges the textures: every pixel publishes its image feedback. */
  textureConverging: boolean;
  /** A pass of the image — opaque or blend — wrote the feedback target: something to reduce. */
  feedbackWritten: boolean;
  /** Revision whose matrices are carried to the GPU and to transparent items. */
  worldUploadRevision: number;
  /** Origin of the render frame of matrices carried to the GPU: the eye of that image. A moving
   *  camera voids it as a scene change voids the revision. */
  worldUploadOrigin: Float64Array;
  /** Ordered signature of the tested half: two images that share it share their occluders, therefore
   *  the partition the next one inherits. */
  occluderSignature: number;
}

export function createWebgpuRunState(): WebgpuRunState {
  return {
    lost: false,
    overBudget: false,
    visible: 0,
    selectedTriangles: 0,
    submittedTriangles: 0,
    uncoveredTriangles: 0,
    frustumRejected: 0,
    lodLevel: 0,
    frame: 0,
    imageRevision: 0,
    diagnostic: 'beauty',
    diagnosticPixelError: 0,
    lastCamera: undefined,
    gpuSelection: undefined,
    gpuFrameActive: false,
    hizPyramidFresh: false,
    gpuMetricsReady: false,
    coverageBudgetLimited: false,
    budgetPixelError: 0,
    coverageBudgetEvent: undefined,
    deferredDrops: new Set(),
    blendPagedTriangles: 0,
    blendUnpagedTriangles: 0,
    blendSubmittedTriangles: 0,
    blendDrawCalls: 0,
    drawnTriangles: 0,
    blendFrustumRejected: 0,
    gpuDrawCalls: 0,
    gpuComputeDispatches: 0,
    lastProgressMs: 0,
    renderPathLogged: false,
    outputDiagnosticLogged: false,
    noOccluderHistory: true,
    hizViewMoved: true,
    previousHizView: undefined,
    temporalHizState: {},
    cpuHizCounts: createHizCounts(),
    cpuHizCounted: false,
    rowsSyncedFrame: -1,
    motion: {},
    selectionUniforms: createSelectionUniforms(),
    selectResult: createSelectionResult(),
    cpuSelectMs: null,
    shown: [],
    desired: [],
    drawn: [],
    ...unmirroredDrawn(),
    pagesEntered: null,
    pagesExited: null,
    opaqueScratch: [],
    transparentScratch: [],
    culledScratch: [],
    readyScratch: [],
    pendingScratch: [],
    hostPendingScratch: [],
    urlScratch: [],
    cutHeld: false,
    cutEpoch: 0,
    pageArrayEpoch: 0,
    pendingHeld: { epoch: -1, cut: -1, limited: false, ready: false },
    urlsHeld: { epoch: -1, cut: -1, limited: false },
    ranksHeld: { epoch: -1, cut: -1, limited: false },
    requestedScratch: new Set<string>(),
    transitionScratch: new Set<string>(),
    gate: createFrameGateCore(HOLD_SIGNATURE_VALUES),
    frameHeld: false,
    textureConverging: false,
    feedbackWritten: false,
    worldUploadRevision: 0,
    // No frame before the first image: it rebases, whatever happens.
    worldUploadOrigin: new Float64Array([NaN, NaN, NaN]),
    occluderSignature: 0,
  };
}
