import * as THREE from 'three';
import {
  createSelectionResult,
  resolvePixelError,
  selectVisiblePages,
  type PageRec,
  type ClusterRoot,
} from './pageSelection.ts';
import type { BackendContext } from './backendTypes.ts';
import { lighting } from './backendCommon.ts';
import { createCpuStepProfile } from './cpuProfile.ts';
import { EXACT_CPU_STEP } from './exactPagesCpu.ts';

export type ExactPagesRenderState = {
  visible: number;
  selectedTriangles: number;
  frame: number;
  overBudget: boolean;
  frustumRejected: number;
  lodLevel: number;
  lastCamera: THREE.PerspectiveCamera | undefined;
  lastPixelError: number;
  /** Temps de la coupe de clusters seule, entre l'appel de sélection et son retour : ni le seuil
   *  adaptatif, ni la résidence, ni les rangs, ni la soumission. */
  cpuSelectMs: number;
  /** Nœuds de hiérarchie que la coupe a dépilés pour cette image. */
  cpuSelectNodesTested: number;
};

export function createExactPagesRender(
  state: ExactPagesRenderState,
  context: BackendContext,
  source: THREE.Object3D,
  blendCopies: THREE.Mesh[],
  sceneLights: ReturnType<typeof lighting>,
  motion: { last?: THREE.Vector3; lastMs?: number },
  roots: ReadonlyArray<ClusterRoot<PageRec>>,
  viewport: [number, number] | undefined,
  cap: number,
  desired: PageRec[],
  shown: PageRec[],
  syncResident: () => void,
  cpuProfile: ReturnType<typeof createCpuStepProfile>,
) {
  // Demande et résultat de la coupe, posés une fois : une image de rendu n'alloue rien du tout.
  const selectOptions = {
    pixelError: 0,
    viewport,
    holdResident: true,
    pageBudget: cap,
    wanted: desired,
    result: createSelectionResult<PageRec>(),
  };
  return (camera: THREE.PerspectiveCamera) => {
    const worldStart = performance.now();
    source.updateMatrixWorld(true);
    for (const copy of blendCopies)
      copy.matrix.copy((copy.userData.sourceMesh as THREE.Mesh).matrixWorld);
    const lightsStart = performance.now();
    sceneLights.update();
    const selectStart = performance.now();
    state.overBudget = false;
    state.frame++;
    state.lastCamera = camera;
    state.lastPixelError = resolvePixelError(context, camera, motion);
    // La demande de coupe est posée une fois pour toutes : l'image de rendu n'alloue rien.
    selectOptions.pixelError = state.lastPixelError;
    // `cpuSelectMs` ne doit dire qu'une chose : la coupe de clusters. Le seuil adaptatif et la
    // caméra sont posés avant cette borne ; la résidence et la soumission sont après.
    const cutStart = performance.now();
    const selected = selectVisiblePages(roots, camera, selectOptions, shown);
    state.cpuSelectMs = performance.now() - cutStart;
    // Truncating a DAG cut would punch holes: its clusters are a partition, not a priority list.
    // Selection already answered the budget with a coarser threshold, so the cover is kept whole and
    // only the flag is raised when even the coarsest cover exceeds the budget.
    state.overBudget = selected.shown.length > cap;
    state.visible = selected.visible;
    state.selectedTriangles = selected.selectedTriangles;
    state.frustumRejected = selected.frustumRejected;
    state.cpuSelectNodesTested = selected.nodesTested;
    state.lodLevel = selected.lodLevel;
    const syncStart = performance.now();
    syncResident();
    const syncEnd = performance.now();
    const row = cpuProfile.row;
    row[EXACT_CPU_STEP.worldMs] = lightsStart - worldStart;
    row[EXACT_CPU_STEP.lightsMs] = selectStart - lightsStart;
    // L'étape `selectMs` du profil garde ses bornes larges : la somme des étapes reste l'image.
    row[EXACT_CPU_STEP.selectMs] = syncStart - selectStart;
    row[EXACT_CPU_STEP.syncMs] = syncEnd - syncStart;
    row[EXACT_CPU_STEP.pendingMs] = 0;
    row[EXACT_CPU_STEP.retainMs] = 0;
    row[EXACT_CPU_STEP.submitMs] = 0;
  };
}
