import * as THREE from 'three';
import { rasterVisibility, type VisPage } from './visibilityBuffer.ts';
import { buildHizPyramid } from './hizDepth.ts';
import { countUnoccluded, filterUnoccluded } from './hizOcclusion.ts';
import { createHizCounts, resetHizCounts, type HizCounts } from './hizCounts.ts';
import { splitOccluders } from './hizSplit.ts';
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
    const vis = rasterVisibility(selected, camera, viewport);
    history.pyramid = buildHizPyramid(vis.depth, viewport[0], viewport[1]);
    history.camera = camera.clone();
    history.viewport = [viewport[0], viewport[1]];
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

  let occluders: T[], rest: T[];
  if (hasPrev) {
    const prevCam = history.camera!;
    const unoccludedInPrev = filterUnoccluded(selected, history.pyramid!, prevCam, viewport);
    const unoccludedSet = new Set(unoccludedInPrev);
    occluders = selected.filter((p) => unoccludedSet.has(p));
    rest = selected.filter((p) => !unoccludedSet.has(p));
    if (!occluders.length || !rest.length) {
      const split = splitOccluders(selected, camera, viewport);
      occluders = split.occluders;
      rest = split.rest;
    }
  } else {
    const split = splitOccluders(selected, camera, viewport);
    occluders = split.occluders;
    rest = split.rest;
  }

  if (!occluders.length || !rest.length) {
    const vis = rasterVisibility(selected, camera, viewport);
    history.pyramid = buildHizPyramid(vis.depth, viewport[0], viewport[1]);
    history.camera = camera.clone();
    history.viewport = [viewport[0], viewport[1]];
    return { shown: selected, hizRejected: 0, occluders, history, counts };
  }

  const visPass1 = rasterVisibility(occluders, camera, viewport);
  const currentPyramid = buildHizPyramid(visPass1.depth, viewport[0], viewport[1]);
  const disoccluded = countUnoccluded(rest, currentPyramid, camera, viewport, counts);
  const shown = [...occluders, ...disoccluded];

  const fullVis = rasterVisibility(shown, camera, viewport);
  history.pyramid = buildHizPyramid(fullVis.depth, viewport[0], viewport[1]);
  history.camera = camera.clone();
  history.viewport = [viewport[0], viewport[1]];

  return { shown, hizRejected: rest.length - disoccluded.length, occluders, history, counts };
}
