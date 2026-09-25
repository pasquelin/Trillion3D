import { frustumExcludesBox, maxStretch, multiplyMatrix4 } from '../../../../sdk-core/src/index.ts';
import type { LightPages } from '../../../../sdk-core/src/scene/light-shadow/pageOverlap.ts';
import { castsNoShadow, openToCamera, selectFlat } from './select.ts';
import {
  IDENTITY_WORLD,
  createSelectionResult,
  residentModeOf,
  selectionScratch,
  selectionState,
  type PageRecord,
  type SelectionResult,
} from './state.ts';
import { copyElements } from '../../math/matrixElements.ts';
import type { ClusterRoot } from '../selection/types.ts';
import { pixelScaleOf } from '../../streaming/priority.ts';
import type { EngineCamera } from '../../camera/world.ts';

/**
 * World pose of a root copied into an owned buffer, once per root: the base product
 * only reads and writes `Float64Array`s (`packages/sdk-core/src/math/matrix/matrix4.ts`), and host-library matrices are ordinary
 * arrays.
 */
const rootWorld = new Float64Array(16);

/** Select the requested LOD cut and the resident cut that can be displayed this frame. */
export function selectVisiblePages<T extends PageRecord>(
  roots: ReadonlyArray<ClusterRoot<T>>,
  cam: EngineCamera,
  options: {
    pixelError?: number;
    viewport?: [number, number];
    holdResident?: boolean;
    isResident?: (page: T) => boolean;
    /** Cuts of one stamp (`nextResidencyStamp`) answer residency alike: nothing loads or leaves
     *  between them, and each root's readiness is read at the first (`./held.ts`). */
    residencyStamp?: number;
    wanted?: T[];
    result?: SelectionResult<T>;
    /** Selects shadow casters from a light into these pages (`SelectionState.light`). */
    light?: LightPages;
  },
  into?: T[],
): SelectionResult<T> {
  const viewport = options.viewport,
    hold = !!options.holdResident;
  const { viewMatrix } = selectionScratch;
  // World frustum planes are those image entry set, in the host's depth convention: an image
  // computes them once, for all of its consumers, and nothing is copied here.
  const worldPlanes = cam.planes;
  pixelScaleOf(cam.projection, viewport, selectionScratch.pixelScale);
  const shown = into ?? ([] as T[]);
  const wanted = options.wanted ?? ([] as T[]);
  // Cut state is set on the reused object: a render image allocates nothing here.
  const state = selectionState<T>();
  state.cam = cam;
  state.wanted = wanted;
  state.shown = shown;
  state.isResident = options.isResident;
  state.light = options.light;
  // The residency rule depends only on the request: stating it here takes two re-reads of the
  // state and one indirect call out of the per-cluster loop, without touching the answer.
  state.residentMode = residentModeOf(hold, options.isResident);
  state.residencyStamp = options.residencyStamp ?? 0;
  state.pixelError = options.pixelError ?? 0;
  state.cameraStretch = maxStretch(cam.view);
  state.flatWorld = roots[0]?.world ?? IDENTITY_WORLD;
  state.flatElements = (roots[0]?.world ?? IDENTITY_WORLD).elements;
  state.flatStretch = 1;
  state.flatFocal = 1;
  state.flatExact = false;
  state.shownCount = 0;
  state.wantedCount = 0;
  state.wantedTriangles = 0;
  state.shownTriangles = 0;
  state.frustumRejected = 0;
  state.nodesTested = 0;
  state.lodLevel = 0;
  state.complete = true;
  for (const root of roots) {
    // A parked instance-buffer row places nothing: its root waits in the tables, untested. A
    // light's cut takes no sprite: it casts no shadow.
    if (root.parked || castsNoShadow(root.sprite, state.light)) continue;
    const box = root.worldBox;
    if (
      box &&
      !openToCamera(state, root) &&
      frustumExcludesBox(worldPlanes, box[0], box[1], box[2], box[3], box[4], box[5])
    ) {
      state.frustumRejected++;
      continue;
    }
    copyElements(rootWorld, root.world.elements);
    multiplyMatrix4(viewMatrix, cam.view, rootWorld);
    selectFlat(state, root);
  }
  // The cut is finished: both lists take their length here, and only once. They thus keep their
  // capacity from one image to the next.
  shown.length = state.shownCount;
  wanted.length = state.wantedCount;
  // Both sums are held as a running total: no more sweep of the records after the cut.
  const displayedTriangles = state.shownTriangles;
  let selectedTriangles = state.wantedTriangles;
  if (!wanted.length) selectedTriangles = displayedTriangles;
  // The result is written into the caller's object when it supplies one: nothing is allocated.
  const result = options.result ?? createSelectionResult<T>();
  result.shown = shown;
  result.wanted = wanted;
  result.visible = wanted.length || shown.length;
  result.selectedTriangles = selectedTriangles;
  result.displayedTriangles = displayedTriangles;
  result.frustumRejected = state.frustumRejected;
  result.nodesTested = state.nodesTested;
  result.lodLevel = state.lodLevel;
  result.complete = state.complete;
  result.pixelError = state.pixelError;
  // The reused state keeps no hold on this image's scene.
  state.isResident = undefined;
  state.light = undefined;
  state.flatHeld = undefined;
  return result;
}
