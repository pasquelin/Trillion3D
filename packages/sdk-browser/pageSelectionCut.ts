import { maxStretch } from '../sdk-core/index.ts';
import * as THREE from 'three';
import { selectFlat } from './pageSelectionCutSelect.ts';
import {
  IDENTITY_WORLD,
  selectionScratch,
  selectionState,
  type PageRecord,
  type SelectionResult,
} from './pageSelectionCutState.ts';
import type { ClusterRoot } from './pageSelectionTypes.ts';

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
    result?: SelectionResult<T>;
  },
  into?: T[],
): SelectionResult<T> {
  const viewport = options.viewport,
    hold = !!options.holdResident;
  const budget = options.pageBudget && options.pageBudget > 0 ? options.pageBudget : 0;
  const { frustum, matrix, viewMatrix } = selectionScratch;
  camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  const width = viewport?.[0] ?? 1,
    height = viewport?.[1] ?? 1;
  selectionScratch.pixelScale[0] = (width * Math.abs(camera.projectionMatrix.elements[0])) / 2;
  selectionScratch.pixelScale[1] = (height * Math.abs(camera.projectionMatrix.elements[5])) / 2;
  const shown = into ?? ([] as T[]);
  shown.length = 0;
  const wanted = options.wanted ?? ([] as T[]);
  // L'état de la coupe est posé sur l'objet réutilisé : une image de rendu n'alloue rien ici.
  const state = selectionState<T>();
  state.camera = camera;
  state.frame = options.frame;
  state.hold = hold;
  state.rootFallback = hold && !!options.rootFallback;
  state.wanted = wanted;
  state.shown = shown;
  state.isResident = options.isResident;
  state.pixelError = options.pixelError ?? 0;
  state.frustumRejected = 0;
  state.lodLevel = 0;
  state.complete = true;
  state.cameraStretch = maxStretch(camera.matrixWorldInverse.elements);
  state.flatWorld = roots[0]?.world ?? IDENTITY_WORLD;
  state.flatElements = (roots[0]?.world ?? IDENTITY_WORLD).elements;
  state.flatStretch = 1;
  state.flatFocal = 1;
  state.flatStructure = undefined;
  state.flatForced = undefined;
  state.flatForcedList = undefined;
  state.flatInside = false;
  state.flatUseForcing = false;
  state.flatMissing = false;
  state.flatShort = false;
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
  // Le résultat est écrit dans l'objet de l'appelant quand il en fournit un : rien n'est alloué.
  const result: SelectionResult<T> = options.result ?? {
    shown,
    wanted,
    visible: 0,
    selectedTriangles: 0,
    displayedTriangles: 0,
    frustumRejected: 0,
    lodLevel: 0,
    complete: true,
    pixelError: 0,
  };
  result.shown = shown;
  result.wanted = wanted;
  result.visible = wanted.length || shown.length;
  result.selectedTriangles = selectedTriangles;
  result.displayedTriangles = displayedTriangles;
  result.frustumRejected = state.frustumRejected;
  result.lodLevel = state.lodLevel;
  result.complete = state.complete;
  result.pixelError = state.pixelError;
  // L'état réutilisé ne garde aucune prise sur la scène de cette image.
  state.isResident = undefined;
  state.flatStructure = undefined;
  state.flatForced = undefined;
  state.flatForcedList = undefined;
  return result;
}
