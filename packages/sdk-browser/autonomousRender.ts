import type * as THREE from 'three';
import { createSelectionResult, selectVisiblePages, type PageRec } from './pageSelection.ts';
import type { BackendContext } from './backendTypes.ts';
import type { installSceneLighting } from './sceneLighting.ts';
import type { WebglFrameGate } from './webglFrameGate.ts';

/** Ce que l'image autonome a décidé, et si elle a été tenue. */
export type AutonomousRenderState = {
  visible: number;
  selectedTriangles: number;
  frustumRejected: number;
  lodLevel: number;
  overBudget: boolean;
  frameHeld: boolean;
};

export const createAutonomousRenderState = (): AutonomousRenderState => ({
  visible: 0,
  selectedTriangles: 0,
  frustumRejected: 0,
  lodLevel: 0,
  overBudget: false,
  frameHeld: false,
});

/**
 * Une image du moteur WebGL autonome. La coupe entière est relancée dès que la vue, la scène ou les
 * ressources ont bougé — une coupe incrémentale de ce chemin est un autre chantier — mais une image
 * que rien n'a touchée n'en relance aucune : la scène attachée est déjà cette image-ci.
 */
export function createAutonomousRender(options: {
  state: AutonomousRenderState;
  context: BackendContext;
  gate: WebglFrameGate;
  lighting: ReturnType<typeof installSceneLighting>;
  roots: Parameters<typeof selectVisiblePages>[0];
  shown: PageRec[];
  desired: PageRec[];
  bootstrap: PageRec[];
  cap: number;
  sync: () => void;
}) {
  const { state, context, gate, lighting, roots, shown, desired, bootstrap, cap, sync } = options;
  const motion: { last?: THREE.Vector3; lastMs?: number } = {};
  // Demande et résultat de la coupe, posés une fois : une image de rendu n'alloue rien du tout, et
  // la coupe écrit `desired` elle-même au lieu d'être recopiée dedans.
  const selectOptions = {
    pixelError: 0,
    viewport: context.viewport,
    holdResident: true,
    wanted: desired,
    result: createSelectionResult<PageRec>(),
  };
  const sourcesDessinees = roots.map((root) => root.pages[0]);
  return (camera: THREE.PerspectiveCamera) => {
    // Entrée d'image : l'ordre et ses garanties vivent dans `frameGateCore.ts`.
    state.frameHeld = gate.enterFrame(
      context,
      camera,
      motion,
      context.viewport,
      context.source,
      sourcesDessinees,
    );
    selectOptions.pixelError = gate.pixelError;
    if (state.frameHeld) return;
    // Les matrices monde et les lampes recopiées ne sont fonction que de la scène.
    if (gate.updateWorlds(context.source)) lighting.update();
    const selected = selectVisiblePages(roots, camera, selectOptions, shown);
    state.visible = selected.visible;
    state.selectedTriangles = selected.selectedTriangles;
    state.frustumRejected = selected.frustumRejected;
    state.lodLevel = selected.lodLevel;
    state.overBudget = shown.length > cap;
    if (state.overBudget) {
      shown.length = 0;
      for (let i = 0; i < bootstrap.length; i++) shown.push(bootstrap[i]);
    }
    sync();
    gate.keep(state.visible, state.selectedTriangles, shown, state.lodLevel, state.overBudget);
  };
}
