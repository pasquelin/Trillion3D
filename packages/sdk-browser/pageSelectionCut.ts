import { frustumExcludesBox, maxStretch, multiplyMatrix4 } from '../sdk-core/index.ts';
import { selectFlat } from './pageSelectionCutSelect.ts';
import {
  IDENTITY_WORLD,
  createSelectionResult,
  residentModeOf,
  selectionScratch,
  selectionState,
  type PageRecord,
  type SelectionResult,
} from './pageSelectionCutState.ts';
import type { ClusterRoot } from './pageSelectionTypes.ts';
import { pixelScaleOf } from './streamingPriority.ts';
import type { EngineCamera } from './cameraWorld.ts';

/** Select the requested LOD cut and the resident cut that can be displayed this frame. */
export function selectVisiblePages<T extends PageRecord>(
  roots: ReadonlyArray<ClusterRoot<T>>,
  cam: EngineCamera,
  options: {
    pixelError?: number;
    viewport?: [number, number];
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
  const { viewMatrix } = selectionScratch;
  // Les plans du tronc monde sont ceux que l'entrée d'image a posés, dans la convention de
  // profondeur de l'hôte : une image les calcule une fois, pour tous ses consommateurs, et rien
  // n'est recopié ici.
  const worldPlanes = cam.planes;
  pixelScaleOf(cam.projection, viewport, selectionScratch.pixelScale);
  const shown = into ?? ([] as T[]);
  const wanted = options.wanted ?? ([] as T[]);
  // L'état de la coupe est posé sur l'objet réutilisé : une image de rendu n'alloue rien ici.
  const state = selectionState<T>();
  state.cam = cam;
  state.hold = hold;
  state.rootFallback = hold && !!options.rootFallback;
  state.wanted = wanted;
  state.shown = shown;
  state.isResident = options.isResident;
  // La règle de résidence ne dépend que de la demande : la dire ici, c'est retirer de la boucle
  // par cluster deux relectures de l'état et un appel indirect, sans toucher à la réponse.
  state.residentMode = residentModeOf(hold, options.isResident);
  state.pixelError = options.pixelError ?? 0;
  state.cameraStretch = maxStretch(cam.view);
  state.flatWorld = roots[0]?.world ?? IDENTITY_WORLD;
  state.flatElements = (roots[0]?.world ?? IDENTITY_WORLD).elements;
  state.flatStretch = 1;
  state.flatFocal = 1;
  state.flatStructure = undefined;
  state.flatForced = undefined;
  state.flatForcedList = undefined;
  state.flatExact = false;
  state.flatUseForcing = false;
  state.flatMissing = false;
  state.flatShort = false;
  state.budget = budget;
  const sweep = () => {
    state.over = false;
    state.shownCount = 0;
    state.wantedCount = 0;
    state.wantedTriangles = 0;
    state.shownTriangles = 0;
    state.frustumRejected = 0;
    state.nodesTested = 0;
    state.lodLevel = 0;
    state.complete = true;
    for (const root of roots) {
      if (state.over) return;
      const box = root.worldBox;
      if (box && frustumExcludesBox(worldPlanes, box[0], box[1], box[2], box[3], box[4], box[5])) {
        state.frustumRejected++;
        continue;
      }
      multiplyMatrix4(viewMatrix, cam.view, root.world.elements);
      selectFlat(state, root);
    }
  };
  sweep();
  // Un passage au-dessus du budget n'apporte qu'une chose : le seuil suivant. La coupe abandonnée
  // s'arrête donc à la page qui dépasse, et seul le passage qui tient le budget est mené au bout.
  // Quand même le seuil le plus grossier dépasse, la coupe entière est refaite : le drapeau de
  // dépassement se lève sur une couverture complète, jamais sur une coupe tronquée.
  for (let attempt = 0; budget && state.over && attempt < 16; attempt++) {
    state.pixelError = state.pixelError > 0 ? state.pixelError * 2 : 1;
    sweep();
  }
  if (state.over) {
    state.budget = 0;
    sweep();
  }
  state.budget = 0;
  // La coupe est finie : les deux listes prennent ici leur longueur, et une seule fois. Elles
  // gardent ainsi leur capacité d'une image à l'autre, au lieu de la reperdre à chaque passage.
  shown.length = state.shownCount;
  wanted.length = state.wantedCount;
  // Les deux sommes sont tenues à la retenue : plus aucun balayage des fiches après la coupe.
  const displayedTriangles = state.shownTriangles;
  let selectedTriangles = state.wantedTriangles;
  if (!wanted.length) selectedTriangles = displayedTriangles;
  // Le résultat est écrit dans l'objet de l'appelant quand il en fournit un : rien n'est alloué.
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
  // L'état réutilisé ne garde aucune prise sur la scène de cette image.
  state.isResident = undefined;
  state.flatStructure = undefined;
  state.flatForced = undefined;
  state.flatForcedList = undefined;
  return result;
}
