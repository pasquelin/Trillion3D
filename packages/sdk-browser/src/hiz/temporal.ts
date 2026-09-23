import { rasterVisibility, type VisPage } from '../visibility/buffer.ts';
import { buildHizPyramid } from './depth.ts';
import { createEngineCamera, holdCameraWorld, type EngineCamera } from '../camera/world.ts';
import { countUnoccluded, filterUnoccluded } from './unoccluded.ts';
import { createHizCounts, resetHizCounts, type HizCounts } from './counts.ts';
import { splitOccludersInto } from './split.ts';
import type { HizPage, HizPyramid } from './types.ts';

export type TemporalHizState = {
  pyramid?: HizPyramid;
  /** Pass-1 pyramid, distinct from the history's: both live in the same frame, each keeps its
   *  buffer from one frame to the next. */
  passPyramid?: HizPyramid;
  camera?: EngineCamera;
  viewport?: [number, number];
};

/** Same tolerance, same walk, without allocating: `Array.prototype.every` asked for a closure
 *  per compared matrix, twice per call and every frame. */
function presqueEgaux(a: ArrayLike<number>, b: ArrayLike<number>) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!(Math.abs(a[i] - b[i]) <= 1e-7)) return false;
  return true;
}

/** Reuse depth only for an identical view. Any camera movement, cut or projection change starts a new history. */
export function sameHizView(previous: EngineCamera | undefined, current: EngineCamera) {
  if (!previous) return false;
  // `previous` is the camera `holdCameraWorld` holds: the same sixteen view and projection
  // numbers the frame entry copied, with nothing to walk up or invert again.
  return (
    presqueEgaux(previous.view, current.view) &&
    presqueEgaux(previous.projection, current.projection)
  );
}

/** Holds the frame that was just rasterised: the camera is copied into the one history already
 *  holds, never cloned, the pyramid rewritten in its own buffer and the viewport in place.
 *  Same pose, same pyramid, no allocation. */
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
