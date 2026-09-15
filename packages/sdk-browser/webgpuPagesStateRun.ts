import type * as THREE from 'three';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import { createSelectionResult, type PageRec, type SelectionResult } from './pageSelection.ts';
import type { GpuSelection, SelectionUniforms } from './gpuSelection.ts';
import { createHizCounts } from './hiz.ts';
import type { HizCounts, TemporalHizState } from './hiz.ts';
import type { SurfaceCapture } from './surfaceBuffer.ts';
import { unmirroredDrawn } from './webgpuPagesHelpers.ts';

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
  lastCamera: THREE.PerspectiveCamera | undefined;
  gpuSelection: GpuSelection | undefined;
  gpuFrameActive: boolean;
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
  /** Triangles of the drawable cut the last adopted readback described. */
  drawnTriangles: number;
  blendFrustumRejected: number;
  gpuDrawCalls: number;
  lastProgressMs: number;
  renderPathLogged: boolean;
  outputDiagnosticLogged: boolean;
  noOccluderHistory: boolean;
  previousHizView: THREE.PerspectiveCamera | undefined;
  temporalHizState: TemporalHizState;
  /** Counters of the CPU occlusion oracle, which runs only where the GPU test does not. */
  cpuHizCounts: HizCounts;
  cpuHizCounted: boolean;
  rowsSyncedFrame: number;
  motion: { last?: THREE.Vector3; lastMs?: number };
  selectionUniforms: SelectionUniforms;
  /** Result of the CPU cut, reused image after image so the cut allocates nothing. */
  selectResult: SelectionResult<PageRec>;
  /** Time of the CPU cut alone; null on an image the GPU cut decided. */
  cpuSelectMs: number | null;
  shown: PageRec[];
  desired: PageRec[];
  drawn: PageRec[];
  /** Vrai quand `drawn` est la recopie de `shown` telle qu'elle est. Écrit par les seules fonctions
   *  de recopie de `webgpuPagesHelpers.ts`. */
  drawnMirrorsShown: boolean;
  /** Where the drawable difference writes its members; nothing downstream reads it. */
  drawnMembers: PageRec[];
  /** Pages the residency path had to touch this image; null before a GPU cut reported one. */
  pagesEntered: number | null;
  pagesExited: number | null;
  // Reused by the cut every image; the cut changes, the arrays behind it do not.
  opaqueScratch: PageRec[];
  transparentScratch: PageRec[];
  culledScratch: PageRec[];
  readyScratch: PageRec[];
  pendingScratch: string[];
  /** Le tableau de la liste rendue à l'hôte, à lui seul : le suivi du rendu écrit dans l'autre, et
   *  une liste tenue d'une image à l'autre ne survivrait pas à ce partage. */
  hostPendingScratch: string[];
  urlScratch: string[];
  /** Vrai quand l'adoption a relu le relevé déjà tenu : `desired` et `shown` n'ont pas bougé. */
  cutHeld: boolean;
  /** Augmente chaque fois qu'une page reçoit ou perd ses octets : ce que la liste attendue lit. */
  pageArrayEpoch: number;
  /** Ce que chaque liste rendue à l'hôte décrit : l'état qui l'a produite, ou `-1` si elle est à
   *  refaire. Une liste n'est gardée que si tout ce dont elle dépend est encore celui-là. */
  pendingHeld: { epoch: number; limited: boolean; ready: boolean };
  urlsHeld: { epoch: number; limited: boolean };
  /** Ensembles d'urls d'une image : remplis puis vidés, jamais réalloués. */
  requestedScratch: Set<string>;
  transitionScratch: Set<string>;
}

/** The secondary-camera surface capture and the explicit readback of the main image. */
export interface WebgpuCaptureState {
  captureAllocationBytes: number;
  surfaceCapture: SurfaceCapture | undefined;
  secondaryCamera: THREE.PerspectiveCamera | undefined;
  surfaceRenderAllowed: boolean;
  capturedRevision: number;
  capturedPixels: Uint8Array | undefined;
  capturePending: Promise<void> | undefined;
  captureStreamingDeferrals: number;
  captureDeferralLogged: boolean;
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
    lastProgressMs: 0,
    renderPathLogged: false,
    outputDiagnosticLogged: false,
    noOccluderHistory: true,
    previousHizView: undefined,
    temporalHizState: {},
    cpuHizCounts: createHizCounts(),
    cpuHizCounted: false,
    rowsSyncedFrame: -1,
    motion: {},
    selectionUniforms: {
      planes: new Float32Array(24),
      view: new Float32Array(16),
      pixelScale: [1, 1],
      pixelError: 0,
      near: 0.1,
      cameraWorld: [0, 0, 0],
    },
    selectResult: createSelectionResult(),
    cpuSelectMs: null,
    shown: [],
    desired: [],
    drawn: [],
    ...unmirroredDrawn(),
    drawnMembers: [],
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
    pageArrayEpoch: 0,
    pendingHeld: { epoch: -1, limited: false, ready: false },
    urlsHeld: { epoch: -1, limited: false },
    requestedScratch: new Set<string>(),
    transitionScratch: new Set<string>(),
  };
}

export function createWebgpuCaptureState(): WebgpuCaptureState {
  return {
    captureAllocationBytes: 0,
    surfaceCapture: undefined,
    secondaryCamera: undefined,
    surfaceRenderAllowed: false,
    capturedRevision: -1,
    capturedPixels: undefined,
    capturePending: undefined,
    captureStreamingDeferrals: 0,
    captureDeferralLogged: false,
  };
}
