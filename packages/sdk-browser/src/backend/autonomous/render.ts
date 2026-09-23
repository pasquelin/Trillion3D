import {
  createSelectionResult,
  selectVisiblePages,
  type PageRec,
} from '../../page/selection/selection.ts';
import type { BackendContext } from '../types.ts';
import type { installSceneLighting } from '../../lighting/sceneLighting.ts';
import type { WebglFrameGate } from '../../webgl/core/frameGate.ts';
import type { CameraMotion, HostCamera } from '../../camera/world.ts';
import type { HostWorldPlacements } from '../../host/world/placements.ts';
import { attachedPages } from '../../placement/autonomousPlacements.ts';

/** What the autonomous frame decided, and whether it was held. */
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
 * One frame of the autonomous WebGL engine. The whole cut is rerun as soon as the view, the scene
 * or the resources have moved — an incremental cut of this path is another job — but a frame that
 * nothing has touched reruns none: the attached scene is already this frame.
 */
export function createAutonomousRender(options: {
  state: AutonomousRenderState;
  context: BackendContext;
  gate: WebglFrameGate;
  lighting: ReturnType<typeof installSceneLighting>;
  roots: Parameters<typeof selectVisiblePages>[0];
  /** The engine's world-matrix index, rebuilt once per scene revision. */
  worlds: HostWorldPlacements;
  shown: PageRec[];
  desired: PageRec[];
  bootstrap: PageRec[];
  cap: number;
  sync: () => void;
}) {
  const { state, context, gate, lighting, roots, worlds, shown, desired, bootstrap, cap, sync } =
    options;
  const motion: CameraMotion = {};
  // Cut request and result, allocated once: a render frame allocates nothing at all, and
  // the cut writes `desired` itself instead of being copied into it.
  const selectOptions = {
    pixelError: 0,
    viewport: context.viewport,
    holdResident: true,
    wanted: desired,
    result: createSelectionResult<PageRec>(),
  };
  const sourcesDessinees = roots.map((root) => root.pages[0]);
  return (camera: HostCamera) => {
    // Frame entry: the order and its guarantees live in `../../frame/gateCore.ts`, which also copies
    // the host camera into the engine camera — the cut now reads only the latter.
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
    // Copied world matrices and lights are a function of the scene only.
    if (gate.updateWorlds(worlds)) lighting.update();
    const selected = selectVisiblePages(roots, gate.cam, selectOptions, shown);
    state.visible = selected.visible;
    state.selectedTriangles = selected.selectedTriangles;
    state.frustumRejected = selected.frustumRejected;
    state.lodLevel = selected.lodLevel;
    state.overBudget = attachedPages(shown) > cap;
    if (state.overBudget) {
      shown.length = 0;
      for (let i = 0; i < bootstrap.length; i++) shown.push(bootstrap[i]);
    }
    sync();
    gate.keep(state.visible, state.selectedTriangles, shown, state.lodLevel, state.overBudget);
  };
}
