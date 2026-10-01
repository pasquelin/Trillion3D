import {
  clipPlanesFromMatrix,
  frustumFarPlane,
  multiplyMatrix4,
} from '../../../../sdk-core/src/index.ts';
import { frameParametersSound } from '../../../../sdk-core/src/lod/screenErrorBound.ts';
import type { ConeContext } from '../cone/cone.ts';
import { worldStretch } from './logic.ts';
import { selectionScratch, type PageRecord, type SelectionState } from './state.ts';
import { traverse } from './visit.ts';
import type { ClusterRoot } from '../selection/types.ts';
import { CARD_ROOT, CASTS_NO_SHADOW } from '../../visibility/shader/spriteWgsl.ts';
import { OPEN_PLANES, openMark } from './openRoot.ts';

/** True when a camera cut walks `root` open (`openMark`). */
export const openToCamera = <T>(s: { light?: unknown }, root: ClusterRoot<T>) =>
  openMark(root.mark, s.light);

/** True when a light's cut leaves a root out: a sprite, or a root set to cast no shadow
 *  (`CASTS_NO_SHADOW`). Read by the CPU cut and the GPU cut's oracle (`dagOracleDescent`). */
export const castsNoShadow = (mark: number | undefined, light: unknown) =>
  !!light && ((mark ?? 0) & CASTS_NO_SHADOW) !== 0;

/** True when a camera's cut leaves a root to its impostor card (`CARD_ROOT`); a light's never
 *  does. Read by the CPU cut and the GPU cut's oracle (`dagOracleDescent`). */
export const drawsCard = (mark: number | undefined, light: unknown) =>
  !light && ((mark ?? 0) & CARD_ROOT) !== 0;

/** Moves each of the six planes out by `reach` along every axis: a box then clears a plane only
 *  if the box grown by `reach` on each side would — the GPU cut does the same (`putPlanes`). */
function growPlanes(planes: Float64Array, reach: number) {
  for (let i = 0; i < 24; i += 4)
    planes[i + 3] +=
      reach * (Math.abs(planes[i]) + Math.abs(planes[i + 1]) + Math.abs(planes[i + 2]));
}

export function selectFlat<T extends PageRecord>(s: SelectionState<T>, root: ClusterRoot<T>) {
  const pages = root.pages;
  const { viewMatrix, clip, planes, pixelScale } = selectionScratch;
  // The packed rank of this root's first page: what `take` adds to a page's index to name the
  // instance, as the world below names its placement (#1235).
  s.flatBase = root.packedBase ?? -1;
  s.flatWorld = root.world;
  s.flatElements = viewMatrix;
  s.flatStretch = worldStretch(root) * s.cameraStretch;
  s.flatFocal = Math.max(pixelScale[0], pixelScale[1]);
  // Null-threshold paths consult neither camera nor sphere: they only hold if the frame's three
  // scalars are those a strictly positive quotient asks for. They never read the projection, which
  // is left out (its default 1 passes).
  const near = s.cam.near;
  s.flatExact =
    s.pixelError === 0 &&
    s.flatStretch > 0 &&
    frameParametersSound(s.flatStretch, s.flatFocal, near);
  // The frame's half of the projection guard, once per root rather than twice per cluster. A frame
  // that fails it is not refused here: each projection then checks everything and throws at the
  // same cluster as before, and a root whose errors are all zero or infinite still never throws.
  s.flatSound = frameParametersSound(s.flatStretch, s.flatFocal, near, s.cam.perspective);
  // The cone context belongs to this root: it will be set at the first cluster that has one.
  (s.flatCone as ConeContext).ready = false;
  // A root that declares it has no cone takes the cone out of the per-cluster path. Silence
  // means "I declared nothing": the cut then tests each page, as before this batch.
  s.flatReach = root.reach ?? 0;
  s.flatCones = !s.light && root.cones !== false && !(s.flatReach > 0);
  // A root that declares all its pages carry their box takes that check out of the per-cluster
  // path. Silence means "I declared nothing": the cut ensures it as before.
  s.flatBoxes = root.boxes === true;
  clipPlanesFromMatrix(planes, multiplyMatrix4(clip, s.cam.projection, viewMatrix));
  // The engine projection no longer has a far plane: the frustum keeps the one the host declares.
  frustumFarPlane(planes, 16, viewMatrix, s.cam.far, false);
  if (openToCamera(s, root)) planes.set(OPEN_PLANES);
  else if (s.flatReach > 0) growPlanes(planes, s.flatReach);
  // The cut rule's residency, when the cut holds any: the nearest resident representation of each
  // surface is then drawn, the wanted cluster or its nearest resident ancestor (`./rule.ts`).
  s.flatHeld = s.held?.readiness(root);
  traverse(s, pages, root.culling);
}
