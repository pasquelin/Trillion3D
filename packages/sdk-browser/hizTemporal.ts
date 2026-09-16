import { rasterVisibility, type VisPage } from './visibilityBuffer.ts';
import { buildHizPyramid } from './hizDepth.ts';
import { createEngineCamera, holdCameraWorld, type EngineCamera } from './cameraWorld.ts';
import { countUnoccluded, filterUnoccluded } from './hizUnoccluded.ts';
import { createHizCounts, resetHizCounts, type HizCounts } from './hizCounts.ts';
import { splitOccludersInto } from './hizSplit.ts';
import type { HizPage, HizPyramid } from './hizTypes.ts';

export type TemporalHizState = {
  pyramid?: HizPyramid;
  /** La pyramide de la passe 1, distincte de celle de l'historique : les deux vivent dans la même
   *  image, chacune garde son tampon d'une image sur l'autre. */
  passPyramid?: HizPyramid;
  camera?: EngineCamera;
  viewport?: [number, number];
};

/** Même tolérance, même parcours, sans allouer : `Array.prototype.every` demandait une fermeture
 *  par matrice comparée, deux fois par appel et à chaque image. */
function presqueEgaux(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!(Math.abs(a[i] - b[i]) <= 1e-7)) return false;
  return true;
}

/** Reuse depth only for an identical view. Any camera movement, cut or projection change starts a new history. */
export function sameHizView(previous: EngineCamera | undefined, current: EngineCamera) {
  if (!previous) return false;
  // `previous` est la caméra gardée par `holdCameraWorld` : les mêmes seize nombres de vue et de
  // projection que l'entrée d'image a recopiés, sans rien à remonter ni à réinverser.
  return (
    presqueEgaux(previous.view, current.view) &&
    presqueEgaux(previous.projection, current.projection)
  );
}

/** Retient l'image qui vient d'être rasterisée : la caméra est recopiée dans celle que l'historique
 *  garde déjà, jamais clonée, la pyramide réécrite dans son propre tampon et le viewport sur place.
 *  Même pose, même pyramide, sans allocation. */
function retiens(
  history: TemporalHizState,
  cam: EngineCamera,
  viewport: [number, number],
  depth: Float32Array,
) {
  history.pyramid = buildHizPyramid(depth, viewport[0], viewport[1], history.pyramid);
  history.camera = holdCameraWorld(history.camera ?? createEngineCamera(), cam);
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
  cam: EngineCamera,
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
    retiens(history, cam, viewport, rasterVisibility(selected, cam, viewport).depth);
    return { shown: selected, hizRejected: 0, occluders: selected, history, counts };
  }
  const hasPrev = !!(
    history.pyramid &&
    history.camera &&
    sameHizView(history.camera, cam) &&
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
    splitOccludersInto(selected, cam, viewport, occluders, rest);

  if (!occluders.length || !rest.length) {
    retiens(history, cam, viewport, rasterVisibility(selected, cam, viewport).depth);
    return { shown: selected, hizRejected: 0, occluders, history, counts };
  }

  const visPass1 = rasterVisibility(occluders, cam, viewport);
  history.passPyramid = buildHizPyramid(
    visPass1.depth,
    viewport[0],
    viewport[1],
    history.passPyramid,
  );
  const disoccluded = countUnoccluded(rest, history.passPyramid, cam, viewport, counts);
  const shown = [...occluders, ...disoccluded];

  retiens(history, cam, viewport, rasterVisibility(shown, cam, viewport).depth);

  return { shown, hizRejected: rest.length - disoccluded.length, occluders, history, counts };
}
