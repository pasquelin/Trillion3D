import {
  clipPlanesFromMatrix,
  frustumFarPlane,
  multiplyMatrix4,
} from '../../../../sdk-core/src/index.ts';
import type { ConeContext } from '../cone/cone.ts';
import { clearForcedMarks, drawnUnderForcing, forceCoarse, worldStretch } from './logic.ts';
import { rootCoverInto, repairFlat } from './repair.ts';
import {
  fallbackScratch,
  residentUnder,
  selectionScratch,
  truncateShown,
  type PageRecord,
  type SelectionState,
} from './state.ts';
import { traverse } from './visit.ts';
import type { ClusterRoot } from '../selection/types.ts';

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
  s.flatCones = root.cones !== false;
  // A root that declares all its pages carry their box takes that check out of the per-cluster
  // path. Silence means "I declared nothing": the cut ensures it as before.
  s.flatBoxes = root.boxes === true;
  clipPlanesFromMatrix(planes, multiplyMatrix4(clip, s.cam.projection, viewMatrix));
  // The engine projection no longer has a far plane: the frustum keeps the one the host declares.
  frustumFarPlane(planes, 16, viewMatrix, s.cam.far, false);
  s.flatStructure = root.structure;
  s.flatForced = root.forced;
  s.flatForcedList = root.forcedList;
  // Force marks of the previous cut fall with the groups that carried them: they come undone
  // group by group, never by a sweep of every node of the primitive.
  const links = root.culling?.links,
    marks = root.culling?.marks;
  if (s.flatForced && s.flatForcedList) clearForcedMarks(s, links, marks);
  const startWanted = s.wantedCount,
    startShown = s.shownCount,
    startRejected = s.frustumRejected,
    startNodes = s.nodesTested;
  s.flatUseForcing = false;
  s.flatMissing = false;
  traverse(s, pages, root.culling);
  if (s.over || !s.hold) return;
  if (!s.flatStructure || !s.flatForced || !s.flatForcedList) {
    if (s.rootFallback && s.flatMissing) repairFlat(s, pages, startShown);
    return;
  }
  const fallbackQueue = fallbackScratch as T[];
  fallbackQueue.length = 0;
  for (let i = startWanted; i < s.wantedCount; i++) fallbackQueue.push(s.wanted[i]);
  s.flatUseForcing = true;
  let forcedAny = false;
  while (fallbackQueue.length) {
    const rec = fallbackQueue.pop() as T;
    if (residentUnder(s, rec, s.residentMode)) continue;
    if (!drawnUnderForcing(s, rec)) continue;
    const own = rec.group;
    if (own == null || own < 0) continue;
    if (s.flatForced[own]) continue;
    forceCoarse(s, own, links, marks);
    forcedAny = true;
    for (
      let i = s.flatStructure.outputOffsets[own];
      i < s.flatStructure.outputOffsets[own + 1];
      i++
    )
      fallbackQueue.push(pages[s.flatStructure.outputs[i]]);
  }
  if (!forcedAny) {
    if (s.rootFallback && s.flatMissing && !rootCoverInto(s, pages, startShown)) s.complete = false;
    s.flatUseForcing = false;
    return;
  }
  truncateShown(s, startShown);
  // The first descent is abandoned: its frustum rejects and visited nodes go with it, as do
  // the pages it had kept. Without that, two frames that carry exactly the same cut announce
  // two different walks depending on whether fallback armed or not, and the held-frame witness
  // never sees them identical.
  s.frustumRejected = startRejected;
  s.nodesTested = startNodes;
  s.flatShort = false;
  traverse(s, pages, root.culling);
  s.flatUseForcing = false;
  if (s.over) return;
  if (s.rootFallback && s.flatShort && !rootCoverInto(s, pages, startShown)) s.complete = false;
}
