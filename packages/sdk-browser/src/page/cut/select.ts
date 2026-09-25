import {
  clipPlanesFromMatrix,
  frustumFarPlane,
  multiplyMatrix4,
} from '../../../../sdk-core/src/index.ts';
import type { ConeContext } from '../cone/cone.ts';
import { worldStretch } from './logic.ts';
import { heldReadiness } from './held.ts';
import { RESIDENT_ALL, selectionScratch, type PageRecord, type SelectionState } from './state.ts';
import { traverse } from './visit.ts';
import type { ClusterRoot } from '../selection/types.ts';

/** True when the camera cut lets every node and page of `root` through: a root never culled
 *  (`ClusterRoot.unculled`). A light's cut still tests it — a sprite casts no shadow. */
export const openToCamera = <T>(s: { light?: unknown }, root: ClusterRoot<T>) =>
  root.unculled === true && !s.light;

/** Six planes no box leaves, `(0, 0, 0, 1)` each: what an open root is walked against, here and
 *  in the GPU cut's oracle (`dagViewFrames`). */
export const OPEN_PLANES = Float64Array.from({ length: 24 }, (_, i) => (i % 4 === 3 ? 1 : 0));

export function selectFlat<T extends PageRecord>(s: SelectionState<T>, root: ClusterRoot<T>) {
  const pages = root.pages;
  const { viewMatrix, clip, planes, pixelScale } = selectionScratch;
  s.flatWorld = root.world;
  s.flatElements = viewMatrix;
  s.flatStretch = worldStretch(root) * s.cameraStretch;
  s.flatFocal = Math.max(pixelScale[0], pixelScale[1]);
  // Null-threshold paths consult neither camera nor sphere: they only hold if the frame's three
  // scalars are those a strictly positive quotient asks for.
  const near = s.cam.near;
  s.flatExact =
    s.pixelError === 0 &&
    s.flatStretch > 0 &&
    Number.isFinite(s.flatStretch) &&
    s.flatFocal > 0 &&
    Number.isFinite(s.flatFocal) &&
    near > 0 &&
    Number.isFinite(near);
  // The cone context belongs to this root: it will be set at the first cluster that has one.
  (s.flatCone as ConeContext).ready = false;
  // A root that declares it has no cone takes the cone out of the per-cluster path. Silence
  // means "I declared nothing": the cut then tests each page, as before this batch.
  s.flatCones = !s.light && root.cones !== false;
  // A root that declares all its pages carry their box takes that check out of the per-cluster
  // path. Silence means "I declared nothing": the cut ensures it as before.
  s.flatBoxes = root.boxes === true;
  clipPlanesFromMatrix(planes, multiplyMatrix4(clip, s.cam.projection, viewMatrix));
  // The engine projection no longer has a far plane: the frustum keeps the one the host declares.
  frustumFarPlane(planes, 16, viewMatrix, s.cam.far, false);
  if (openToCamera(s, root)) planes.set(OPEN_PLANES);
  // The cut rule's residency, when the cut holds any: the nearest resident representation of each
  // surface is then drawn, the wanted cluster or its nearest resident ancestor (`./rule.ts`).
  s.flatHeld = s.residentMode === RESIDENT_ALL ? undefined : heldReadiness(s, root);
  traverse(s, pages, root.culling);
}
