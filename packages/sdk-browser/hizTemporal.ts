import * as THREE from 'three';
import { rasterVisibility, type VisPage } from './visibilityBuffer.ts';
import { buildHizPyramid } from './hizDepth.ts';
import { countUnoccluded, filterUnoccluded } from './hizUnoccluded.ts';
import { createHizCounts, resetHizCounts, type HizCounts } from './hizCounts.ts';
import { splitOccludersInto } from './hizSplit.ts';
import type { HizPage, HizPyramid } from './hizTypes.ts';

export type TemporalHizState = {
  pyramid?: HizPyramid;
  camera?: THREE.PerspectiveCamera;
  viewport?: [number, number];
};

/** Reuse depth only for an identical view. Any camera movement, cut or projection change starts a new history. */
export function sameHizView(
  previous: THREE.PerspectiveCamera | undefined,
  current: THREE.PerspectiveCamera,
) {
  if (!previous) return false;
  previous.updateMatrixWorld();
  current.updateMatrixWorld();
  const equal = (a: readonly number[], b: readonly number[]) =>
    a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) <= 1e-7);
  return (
    equal(previous.matrixWorldInverse.elements, current.matrixWorldInverse.elements) &&
    equal(previous.projectionMatrix.elements, current.projectionMatrix.elements)
  );
}

/** La pyramide de la passe 1, distincte de celle de l'historique : les deux vivent dans la même
 *  image, chacune garde son tampon d'une image sur l'autre. */
let passPyramid: HizPyramid | undefined;

/** Retient l'image qui vient d'être rasterisée : la caméra est recopiée dans celle que l'historique
 *  garde déjà, jamais clonée, la pyramide réécrite dans son propre tampon et le viewport sur place.
 *  Même pose, même pyramide, sans allocation. */
function retiens(
  history: TemporalHizState,
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
  depth: Float32Array,
) {
  history.pyramid = buildHizPyramid(depth, viewport[0], viewport[1], history.pyramid);
  history.camera = (history.camera ?? new THREE.PerspectiveCamera()).copy(camera, false);
  if (!history.viewport) history.viewport = [viewport[0], viewport[1]];
  else {
    history.viewport[0] = viewport[0];
    history.viewport[1] = viewport[1];
  }
}

/**
 * Apply Temporal Hi-Z occlusion culling using previous frame's depth pyramid reprojection.
 * Candidate pages are tested against the previous frame's Hi-Z pyramid.
 * Previously visible pages form Pass 1 occluders; current frame pyramid is built, then occluded
 * or newly disoccluded pages are tested in Pass 2.
 */
export function applyTemporalHiz<T extends HizPage & VisPage>(
  selected: T[],
  camera: THREE.PerspectiveCamera,
  viewport: [number, number],
  history: TemporalHizState = {},
  counts: HizCounts = createHizCounts(),
): {
  shown: T[];
  hizRejected: number;
  occluders: T[];
  history: TemporalHizState;
  counts: HizCounts;
} {
  resetHizCounts(counts);
  if (selected.length < 2) {
    retiens(history, camera, viewport, rasterVisibility(selected, camera, viewport).depth);
    return { shown: selected, hizRejected: 0, occluders: selected, history, counts };
  }
  const hasPrev = !!(
    history.pyramid &&
    history.camera &&
    sameHizView(history.camera, camera) &&
    history.viewport &&
    history.viewport[0] === viewport[0] &&
    history.viewport[1] === viewport[1]
  );

  const occluders: T[] = [],
    rest: T[] = [];
  if (hasPrev) {
    const prevCam = history.camera!;
    const unoccludedSet = new Set(filterUnoccluded(selected, history.pyramid!, prevCam, viewport));
    for (let i = 0; i < selected.length; i++)
      (unoccludedSet.has(selected[i]) ? occluders : rest).push(selected[i]);
  }
  if (!occluders.length || !rest.length)
    splitOccludersInto(selected, camera, viewport, occluders, rest);

  if (!occluders.length || !rest.length) {
    retiens(history, camera, viewport, rasterVisibility(selected, camera, viewport).depth);
    return { shown: selected, hizRejected: 0, occluders, history, counts };
  }

  const visPass1 = rasterVisibility(occluders, camera, viewport);
  passPyramid = buildHizPyramid(visPass1.depth, viewport[0], viewport[1], passPyramid);
  const disoccluded = countUnoccluded(rest, passPyramid, camera, viewport, counts);
  const shown = [...occluders, ...disoccluded];

  retiens(history, camera, viewport, rasterVisibility(shown, camera, viewport).depth);

  return { shown, hizRejected: rest.length - disoccluded.length, occluders, history, counts };
}
