import * as THREE from 'three';
import {
  resolvePixelError,
  selectVisiblePages,
  type PageRec,
  type ClusterRoot,
  type SelectionResult,
} from './pageSelection.ts';
import type { BackendContext } from './backendTypes.ts';
import { lighting } from './backendCommon.ts';
import { createCpuStepProfile } from './cpuProfile.ts';

export type ExactPagesRenderState = {
  visible: number;
  selectedTriangles: number;
  frame: number;
  overBudget: boolean;
  frustumRejected: number;
  lodLevel: number;
  lastCamera: THREE.PerspectiveCamera | undefined;
  lastPixelError: number;
  /** Temps de la coupe seule : le seul poste que ce moteur choisit sur le processeur. */
  cpuSelectMs: number;
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
    frame: 0,
    holdResident: true,
    pageBudget: cap,
    wanted: desired,
    result: {
      shown,
      wanted: desired,
      visible: 0,
      selectedTriangles: 0,
      displayedTriangles: 0,
      frustumRejected: 0,
      lodLevel: 0,
      complete: true,
      pixelError: 0,
    } as SelectionResult<PageRec>,
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
    selectOptions.frame = state.frame;
    const selected = selectVisiblePages(roots, camera, selectOptions, shown);
    // Truncating a DAG cut would punch holes: its clusters are a partition, not a priority list.
    // Selection already answered the budget with a coarser threshold, so the cover is kept whole and
    // only the flag is raised when even the coarsest cover exceeds the budget.
    state.overBudget = selected.shown.length > cap;
    state.visible = selected.visible;
    state.selectedTriangles = selected.selectedTriangles;
    state.frustumRejected = selected.frustumRejected;
    state.lodLevel = selected.lodLevel;
    const syncStart = performance.now();
    syncResident();
    const syncEnd = performance.now();
    state.cpuSelectMs = syncStart - selectStart;
    const row = cpuProfile.row;
    row[0] = lightsStart - worldStart;
    row[1] = selectStart - lightsStart;
    row[2] = state.cpuSelectMs;
    row[3] = syncEnd - syncStart;
    row[5] = 0;
    row[6] = 0;
    row[7] = 0;
  };
}
