import * as THREE from 'three';
import {
  resolvePixelError,
  selectVisiblePages,
  type PageRec,
  type ClusterRoot,
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
    const selected = selectVisiblePages(
      roots,
      camera,
      {
        pixelError: state.lastPixelError,
        viewport,
        frame: state.frame,
        holdResident: true,
        pageBudget: cap,
        wanted: desired,
      },
      shown,
    );
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
    const row = cpuProfile.row;
    row[0] = lightsStart - worldStart;
    row[1] = selectStart - lightsStart;
    row[2] = syncStart - selectStart;
    row[3] = syncEnd - syncStart;
    row[5] = 0;
    row[6] = 0;
    row[7] = 0;
  };
}
