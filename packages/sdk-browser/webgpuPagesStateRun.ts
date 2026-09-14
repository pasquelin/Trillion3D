import type * as THREE from 'three';
import type { DiagnosticMode } from '../sdk-core/index.ts';
import type { PageRec } from './pageSelection.ts';
import type { GpuSelection, SelectionUniforms } from './gpuSelection.ts';
import type { TemporalHizState } from './hiz.ts';
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
  rowsSyncedFrame: number;
  lightState: { count: number; types: string[] } | undefined;
  motion: { last?: THREE.Vector3; lastMs?: number };
  selectionUniforms: SelectionUniforms;
  shown: PageRec[];
  desired: PageRec[];
  drawn: PageRec[];
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
    shown: [],
    desired: [],
    drawn: [],
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
