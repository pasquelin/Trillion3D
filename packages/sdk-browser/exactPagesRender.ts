import * as THREE from 'three';
import {
  createSelectionResult,
  resolvePixelError,
  selectVisiblePages,
  type PageRec,
  type ClusterRoot,
} from './pageSelection.ts';
import type { BackendContext } from './backendTypes.ts';
import { lighting } from './backendCommon.ts';
import { createCpuStepProfile } from './cpuProfile.ts';
import { EXACT_CPU_STEP } from './exactPagesCpu.ts';
import type { WebglFrameGate } from './webglFrameGate.ts';

export type ExactPagesRenderState = {
  visible: number;
  selectedTriangles: number;
  frame: number;
  overBudget: boolean;
  frustumRejected: number;
  lodLevel: number;
  lastCamera: THREE.PerspectiveCamera | undefined;
  lastPixelError: number;
  /** Temps de la coupe de clusters seule, entre l'appel de sélection et son retour : ni le seuil
   *  adaptatif, ni la résidence, ni les rangs, ni la soumission. */
  cpuSelectMs: number;
  /** Nœuds de hiérarchie que la coupe a dépilés pour cette image. */
  cpuSelectNodesTested: number;
  /** Vrai quand l'image a été tenue : aucune étape processeur n'a été exécutée. */
  frameHeld: boolean;
};

export function createExactPagesRenderState(): ExactPagesRenderState {
  return {
    visible: 0,
    selectedTriangles: 0,
    frame: 0,
    overBudget: false,
    frustumRejected: 0,
    lodLevel: 0,
    lastCamera: undefined,
    lastPixelError: 0,
    cpuSelectMs: 0,
    cpuSelectNodesTested: 0,
    frameHeld: false,
  };
}

/** Les étapes processeur d'une image tenue, remises à zéro : la liste ne dépend de rien et se lit
 *  une fois, pas à chaque image du régime stationnaire que la tenue d'image installe. */
const EXACT_CPU_STEPS = Object.values(EXACT_CPU_STEP);

export function createExactPagesRender(options: {
  state: ExactPagesRenderState;
  context: BackendContext;
  source: THREE.Object3D;
  blendCopies: THREE.Mesh[];
  sceneLights: ReturnType<typeof lighting>;
  motion: { last?: THREE.Vector3; lastMs?: number };
  roots: ReadonlyArray<ClusterRoot<PageRec>>;
  viewport: [number, number] | undefined;
  cap: number;
  desired: PageRec[];
  shown: PageRec[];
  syncResident: () => void;
  cpuProfile: ReturnType<typeof createCpuStepProfile>;
  gate: WebglFrameGate;
}) {
  const {
    state,
    context,
    source,
    blendCopies,
    sceneLights,
    motion,
    roots,
    viewport,
    cap,
    desired,
    shown,
    syncResident,
    cpuProfile,
    gate,
  } = options;
  // Demande et résultat de la coupe, posés une fois : une image de rendu n'alloue rien du tout.
  const selectOptions = {
    pixelError: 0,
    viewport,
    holdResident: true,
    pageBudget: cap,
    wanted: desired,
    result: createSelectionResult<PageRec>(),
  };
  // Ce que ce moteur dessine, par le nœud source d'où chaque chose sort : une page par racine — les
  // instances d'un même modèle le nomment toutes —, et les copies transparentes hors DAG.
  const sourcesDessinees = [
    ...roots.map((root) => root.pages[0]),
    ...blendCopies.map((copy) => copy.userData),
  ];
  /**
   * Une image tenue n'a exécuté aucune étape : son profil le dit en zéros, pas en estimations, et
   * la durée de coupe comme le nombre de nœuds visités valent zéro parce qu'aucune coupe n'a été
   * faite — jamais ceux de la dernière image qui en a fait une. Ce que l'image MONTRE reste décrit
   * par la coupe qu'elle réaffiche : pages retenues, triangles sélectionnés, rejet par le tronc et
   * niveau de détail ne bougent pas, puisque c'est la même coupe.
   */
  const heldProfile = () => {
    const row = cpuProfile.row;
    for (const step of EXACT_CPU_STEPS) row[step] = 0;
    state.cpuSelectMs = 0;
    state.cpuSelectNodesTested = 0;
  };
  return (camera: THREE.PerspectiveCamera) => {
    state.frame++;
    state.lastCamera = camera;
    // La caméra aussi, ancêtres compris : un rig d'hôte n'appartient pas à la scène préparée, et
    // `updateWorlds` ne remonte que celle-ci. Avant tout le reste : la vitesse du seuil adaptatif,
    // la révision de vue, la coupe et le raster lisent tous cette même pose.
    camera.updateWorldMatrix(true, false);
    // La vitesse de la caméra se lit à chaque image, tenue ou non : la sauter fausserait le seuil
    // adaptatif de la première image qui bouge à nouveau.
    state.lastPixelError = resolvePixelError(context, camera, motion);
    gate.viewChanged(camera, viewport, state.lastPixelError);
    // L'hôte a le droit d'écrire le graphe source sans passer par le moteur : la relecture est ce
    // qui l'annonce, et elle précède la décision de tenir l'image.
    gate.readScene(source, sourcesDessinees);
    // Rien n'a bougé et les deux images précédentes ont produit la même coupe : la scène attachée
    // est déjà cette image-ci, et l'hôte la redessine telle quelle.
    state.frameHeld = gate.held();
    if (state.frameHeld) return heldProfile();
    const worldStart = performance.now();
    // Les matrices monde et les copies transparentes ne sont fonction que de la scène.
    const worldsMoved = gate.updateWorlds(source);
    if (worldsMoved)
      for (const copy of blendCopies)
        copy.matrix.copy((copy.userData.sourceMesh as THREE.Mesh).matrixWorld);
    const lightsStart = performance.now();
    // Les lampes recopiées dans la scène de rendu ne lisent que le graphe source : même révision.
    if (worldsMoved) sceneLights.update();
    const selectStart = performance.now();
    state.overBudget = false;
    // La demande de coupe est posée une fois pour toutes : l'image de rendu n'alloue rien.
    selectOptions.pixelError = state.lastPixelError;
    // `cpuSelectMs` ne doit dire qu'une chose : la coupe de clusters. Le seuil adaptatif et la
    // caméra sont posés avant cette borne ; la résidence et la soumission sont après.
    const cutStart = performance.now();
    const selected = selectVisiblePages(roots, camera, selectOptions, shown);
    state.cpuSelectMs = performance.now() - cutStart;
    // Truncating a DAG cut would punch holes: its clusters are a partition, not a priority list.
    // Selection already answered the budget with a coarser threshold, so the cover is kept whole and
    // only the flag is raised when even the coarsest cover exceeds the budget.
    state.overBudget = selected.shown.length > cap;
    state.visible = selected.visible;
    state.selectedTriangles = selected.selectedTriangles;
    state.frustumRejected = selected.frustumRejected;
    state.cpuSelectNodesTested = selected.nodesTested;
    state.lodLevel = selected.lodLevel;
    const syncStart = performance.now();
    syncResident();
    const syncEnd = performance.now();
    const row = cpuProfile.row;
    row[EXACT_CPU_STEP.worldMs] = lightsStart - worldStart;
    row[EXACT_CPU_STEP.lightsMs] = selectStart - lightsStart;
    // L'étape `selectMs` du profil garde ses bornes larges : la somme des étapes reste l'image.
    row[EXACT_CPU_STEP.selectMs] = syncStart - selectStart;
    row[EXACT_CPU_STEP.syncMs] = syncEnd - syncStart;
    row[EXACT_CPU_STEP.pendingMs] = 0;
    row[EXACT_CPU_STEP.retainMs] = 0;
    row[EXACT_CPU_STEP.submitMs] = 0;
    gate.keep(state.visible, state.selectedTriangles, shown, state.lodLevel, state.overBudget);
  };
}
