import { maxStretch } from '../sdk-core/index.ts';
import * as THREE from 'three';
import { selectFlat } from './pageSelectionCutSelect.ts';
import {
  IDENTITY_WORLD,
  selectionScratch,
  type PageRecord,
  type SelectionState,
} from './pageSelectionCutState.ts';
import type { ClusterRoot } from './pageSelectionTypes.ts';
import { pixelScaleOf } from './streamingPriority.ts';

/** Select the requested LOD cut and the resident cut that can be displayed this frame. */
export function selectVisiblePages<T extends PageRecord>(
  roots: ReadonlyArray<ClusterRoot<T>>,
  camera: THREE.PerspectiveCamera,
  options: {
    pixelError?: number;
    viewport?: [number, number];
    frame: number;
    holdResident?: boolean;
    isResident?: (page: T) => boolean;
    rootFallback?: boolean;
    pageBudget?: number;
    wanted?: T[];
  },
  into?: T[],
) {
  const viewport = options.viewport,
    hold = !!options.holdResident;
  const budget = options.pageBudget && options.pageBudget > 0 ? options.pageBudget : 0;
  const { frustum, matrix, viewMatrix } = selectionScratch;
  camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  pixelScaleOf(camera, viewport, selectionScratch.pixelScale);
  const shown = into ?? ([] as T[]);
  shown.length = 0;
  const wanted = options.wanted ?? ([] as T[]);
  const state: SelectionState<T> = {
    camera,
    frame: options.frame,
    hold,
    rootFallback: hold && !!options.rootFallback,
    wanted,
    shown,
    pageResident: (rec) => !hold || (options.isResident ? options.isResident(rec) : !!rec.array),
    pixelError: options.pixelError ?? 0,
    frustumRejected: 0,
    lodLevel: 0,
    complete: true,
    cameraStretch: maxStretch(camera.matrixWorldInverse.elements),
    flatWorld: roots[0]?.world ?? IDENTITY_WORLD,
    flatElements: (roots[0]?.world ?? IDENTITY_WORLD).elements,
    flatStretch: 1,
    flatFocal: 1,
    flatInside: false,
    flatUseForcing: false,
    flatMissing: false,
    flatShort: false,
  };
  const sweep = () => {
    shown.length = 0;
    wanted.length = 0;
    state.frustumRejected = 0;
    state.lodLevel = 0;
    state.complete = true;
    for (const root of roots) {
      if (root.worldBox && !frustum.intersectsBox(root.worldBox)) {
        state.frustumRejected++;
        continue;
      }
      viewMatrix.multiplyMatrices(camera.matrixWorldInverse, root.world);
      selectFlat(state, root);
    }
  };
  sweep();
  for (let attempt = 0; budget && shown.length > budget && attempt < 16; attempt++) {
    state.pixelError = state.pixelError > 0 ? state.pixelError * 2 : 1;
    sweep();
  }
  let selectedTriangles = 0,
    displayedTriangles = 0;
  for (let i = 0; i < wanted.length; i++) selectedTriangles += wanted[i].triangles;
  for (let i = 0; i < shown.length; i++) displayedTriangles += shown[i].triangles;
  if (!wanted.length) selectedTriangles = displayedTriangles;
  return {
    shown,
    wanted,
    visible: wanted.length || shown.length,
    selectedTriangles,
    displayedTriangles,
    frustumRejected: state.frustumRejected,
    lodLevel: state.lodLevel,
    complete: state.complete,
    pixelError: state.pixelError,
  };
}
