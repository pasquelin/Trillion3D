import type { HostCamera } from './cameraWorld.ts';
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
import type { CameraMotion, EngineCamera } from './cameraWorld.ts';
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
  /** Vrai quand la pyramide Hi-Z a été construite dans la soumission en cours : le test
   *  d'occultation des transparents ne dépouille jamais une pyramide d'une autre image. */
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
  /** Triangles of the drawable cut the last adopted readback described. */
  drawnTriangles: number;
  blendFrustumRejected: number;
  gpuDrawCalls: number;
  lastProgressMs: number;
  renderPathLogged: boolean;
  outputDiagnosticLogged: boolean;
  noOccluderHistory: boolean;
  /** Âge de la table dont l'historique d'occulteurs par ligne est sorti : une table nouvelle
   *  redistribue les lignes, donc cet historique-là ne décrit plus rien. */
  occluderHistoryEpoch: number;
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
  /** L'âge des listes de la coupe : augmente dès qu'une adoption ou la coupe processeur les réécrit,
   *  y compris hors du rendu. Ce que lit qui garde une liste d'une image à l'autre. */
  cutEpoch: number;
  /** Augmente chaque fois qu'une page reçoit ou perd ses octets : ce que la liste attendue lit. */
  pageArrayEpoch: number;
  /** Ce que chaque liste rendue à l'hôte décrit : l'état qui l'a produite, ou `-1` si elle est à
   *  refaire. Une liste n'est gardée que si tout ce dont elle dépend est encore celui-là. */
  pendingHeld: { epoch: number; cut: number; limited: boolean; ready: boolean };
  urlsHeld: { epoch: number; cut: number; limited: boolean };
  /** Ensembles d'urls d'une image : remplis puis vidés, jamais réalloués. */
  requestedScratch: Set<string>;
  transitionScratch: Set<string>;
  /** L'entrée d'image : les trois révisions, l'origine de la vue, la relecture du graphe source, la
   *  remontée des matrices monde et le témoin d'image tenue. Voir `frameGateCore.ts`. */
  gate: FrameGateCore;
  /** Vrai quand l'image en cours a été tenue : aucune étape processeur n'a été exécutée. */
  frameHeld: boolean;
  /** La révision dont les matrices sont portées à la carte et aux items transparents. */
  worldUploadRevision: number;
  /** Signature ordonnée de la moitié testée : deux images qui la partagent partagent leurs
   *  occulteurs, donc la partition que la suivante hérite. */
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
    lastProgressMs: 0,
    renderPathLogged: false,
    outputDiagnosticLogged: false,
    noOccluderHistory: true,
    occluderHistoryEpoch: -1,
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
    cutEpoch: 0,
    pageArrayEpoch: 0,
    pendingHeld: { epoch: -1, cut: -1, limited: false, ready: false },
    urlsHeld: { epoch: -1, cut: -1, limited: false },
    requestedScratch: new Set<string>(),
    transitionScratch: new Set<string>(),
    gate: createFrameGateCore(HOLD_SIGNATURE_VALUES),
    frameHeld: false,
    worldUploadRevision: 0,
    occluderSignature: 0,
  };
}
