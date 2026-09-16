import { clipPlanesFromMatrix, multiplyMatrix4 } from '../sdk-core/index.ts';
import type { ConeContext } from './pageCone.ts';
import {
  clearForcedMarks,
  drawnUnderForcing,
  forceCoarse,
  worldStretch,
} from './pageSelectionCutLogic.ts';
import { rootCoverInto, repairFlat } from './pageSelectionCutRepair.ts';
import {
  fallbackScratch,
  residentUnder,
  selectionScratch,
  truncateShown,
  type PageRecord,
  type SelectionState,
} from './pageSelectionCutState.ts';
import { traverse } from './pageSelectionCutVisit.ts';
import type { ClusterRoot } from './pageSelectionTypes.ts';

export function selectFlat<T extends PageRecord>(s: SelectionState<T>, root: ClusterRoot<T>) {
  const pages = root.pages;
  const { viewMatrix, clip, planes, pixelScale } = selectionScratch;
  s.flatWorld = root.world;
  s.flatElements = viewMatrix;
  s.flatStretch = worldStretch(root) * s.cameraStretch;
  s.flatFocal = Math.max(pixelScale[0], pixelScale[1]);
  // Les chemins à seuil nul ne consultent ni caméra ni sphère : ils ne valent que si les trois
  // scalaires de l'image sont ceux qu'un quotient strictement positif demande.
  const near = s.cam.near;
  s.flatExact =
    s.pixelError === 0 &&
    s.flatStretch > 0 &&
    Number.isFinite(s.flatStretch) &&
    s.flatFocal > 0 &&
    Number.isFinite(s.flatFocal) &&
    near > 0 &&
    Number.isFinite(near);
  // Le contexte de cône appartient à cette racine : il sera posé au premier cluster qui en a un.
  (s.flatCone as ConeContext).ready = false;
  // Une racine qui déclare n'avoir aucun cône sort le cône du chemin par cluster. Le silence vaut
  // « je n'ai rien déclaré » : la coupe teste alors chaque page, comme avant ce lot.
  s.flatCones = root.cones !== false;
  // Une racine qui déclare que toutes ses pages portent leur boîte sort cette vérification du
  // chemin par cluster. Le silence vaut « je n'ai rien déclaré » : la coupe s'en assure comme avant.
  s.flatBoxes = root.boxes === true;
  clipPlanesFromMatrix(planes, multiplyMatrix4(clip, s.cam.projection, viewMatrix));
  s.flatStructure = root.structure;
  s.flatForced = root.forced;
  s.flatForcedList = root.forcedList;
  // Les marques de forçage de la coupe précédente tombent avec les groupes qui les portaient :
  // elles se défont groupe par groupe, jamais par un balayage de tous les nœuds de la primitive.
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
  // La première descente est abandonnée : ses rejets par le tronc et ses nœuds visités le sont avec
  // elle, comme les pages qu'elle avait retenues. Sans cela, deux images qui portent exactement la
  // même coupe annoncent deux parcours différents selon que le repli s'est armé ou non, et le
  // témoin d'image tenue ne les voit jamais identiques.
  s.frustumRejected = startRejected;
  s.nodesTested = startNodes;
  s.flatShort = false;
  traverse(s, pages, root.culling);
  s.flatUseForcing = false;
  if (s.over) return;
  if (s.rootFallback && s.flatShort && !rootCoverInto(s, pages, startShown)) s.complete = false;
}
