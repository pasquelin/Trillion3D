import type * as THREE from 'three';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import { createSelectionResult, type PageRec, type SelectionResult } from './pageSelection.ts';
import type { GpuSelection, SelectionUniforms } from './gpuSelection.ts';
import { createHizCounts } from './hiz.ts';
import type { HizCounts, TemporalHizState } from './hiz.ts';
import type { SurfaceCapture } from './surfaceBuffer.ts';

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
  blendSubmittedTriangles: number;
  blendDrawCalls: number;
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
  lightState: { count: number; types: string[] } | undefined;
  motion: { last?: THREE.Vector3; lastMs?: number };
  selectionUniforms: SelectionUniforms;
  /** Result of the CPU cut, reused image after image so the cut allocates nothing. */
  selectResult: SelectionResult<PageRec>;
  /** Time of the CPU cut alone; null on an image the GPU cut decided. */
  cpuSelectMs: number | null;
  shown: PageRec[];
  desired: PageRec[];
  drawn: PageRec[];
  /**
   * How many leading entries of `shown` and `desired` are the opaque cut, which the GPU readback
   * maintains from one image to the next; the transparent tail after them is the only part an image
   * rewrites. -1 says the CPU cut wrote the array and the split is unknown.
   */
  shownOpaque: number;
  desiredOpaque: number;
  /** Triangles of that opaque head of `shown`; -1 when it was not counted. */
  shownOpaqueTriangles: number;
  /** The transparent cut of the image: the GPU cut never selects it, so the CPU re-reads it whole. */
  transparentWanted: PageRec[];
  transparentShown: PageRec[];
  /** Pages the residency path had to touch this image; null before a GPU cut reported one. */
  pagesEntered: number | null;
  pagesExited: number | null;
  // Reused by the cut every image; the cut changes, the arrays behind it do not.
  opaqueScratch: PageRec[];
  transparentScratch: PageRec[];
  drawableScratch: PageRec[];
  culledScratch: PageRec[];
  readyScratch: PageRec[];
  pendingScratch: string[];
  urlScratch: string[];
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
    blendSubmittedTriangles: 0,
    blendDrawCalls: 0,
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
    lightState: undefined,
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
    shownOpaque: -1,
    desiredOpaque: -1,
    shownOpaqueTriangles: -1,
    transparentWanted: [],
    transparentShown: [],
    pagesEntered: null,
    pagesExited: null,
    opaqueScratch: [],
    transparentScratch: [],
    drawableScratch: [],
    culledScratch: [],
    readyScratch: [],
    pendingScratch: [],
    urlScratch: [],
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
