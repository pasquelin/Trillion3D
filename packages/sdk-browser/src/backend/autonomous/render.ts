import {
  createSelectionResult,
  selectVisiblePages,
  type ClusterRoot,
  type PageRec,
} from '../../page/selection/selection.ts';
import type { BackendContext } from '../types.ts';
import type { installSceneLighting } from '../../lighting/sceneLighting.ts';
import type { WebglFrameGate } from '../../webgl/core/frameGate.ts';
import type { CameraMotion, HostCamera } from '../../camera/world.ts';
import type { HostWorldPlacements } from '../../host/world/placements.ts';
import type { BlendCopy } from '../../cluster/blendCopyContract.ts';
import { showBlendCopy } from '../../cluster/blendCopyMesh.ts';
import { attachedPages } from '../../placement/autonomousPlacements.ts';
import { followHostVisibility } from '../../placement/hidden.ts';
import type { createGeometryBudget } from './pool.ts';
import { MAX_SEARCH_STEPS } from './poolSearch.ts';

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
  roots: ClusterRoot<PageRec>[];
  /** The transparent copies the scene draws whole, hidden with their source node. */
  blendCopies: readonly BlendCopy[];
  /** The engine's world-matrix index, rebuilt once per scene revision. */
  worlds: HostWorldPlacements;
  shown: PageRec[];
  desired: PageRec[];
  bootstrap: PageRec[];
  cap: number;
  sync: () => void;
  /** The image drew another cut: what it keeps is gathered again when read (`residency.ts`). */
  keptChanged: () => void;
  /** The geometry pool: the search the cut runs under its slots, and the shedding of what it left
   *  (`pool.ts`). */
  pool: Pick<ReturnType<typeof createGeometryBudget>, 'search' | 'slotsOf' | 'settling' | 'trim'>;
}) {
  const {
    state,
    context,
    gate,
    lighting,
    roots,
    blendCopies,
    worlds,
    shown,
    desired,
    bootstrap,
    cap,
    sync,
    keptChanged,
    pool,
  } = options;
  const motion: CameraMotion = {};
  // Cut request and result, allocated once: a render frame allocates nothing at all, and
  // the cut writes `desired` itself instead of being copied into it.
  const selectOptions = {
    pixelError: 0,
    viewport: context.viewport,
    holdResident: true,
    slotsOf: pool.slotsOf,
    search: pool.search,
    wanted: desired,
    result: createSelectionResult<PageRec>(),
  };
  const sourcesDessinees = roots.map((root) => root.pages[0]);
  // The view revision of the last image the cut ran in, and its camera.
  let viewSeen = -1,
    lastCamera: HostCamera | undefined;
  const frame = (camera: HostCamera) => {
    lastCamera = camera;
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
    if (state.frameHeld) return;
    // The cut fits the pool in this image: its threshold is searched from the last image's.
    selectOptions.pixelError = gate.pixelError;
    // Copied world matrices and lights are a function of the scene only.
    // A node the host hid or showed parks its roots and hides its copies, or takes them back
    // (`placement/hidden.ts`).
    if (gate.updateWorlds(worlds)) {
      followHostVisibility(roots, {
        entries: blendCopies,
        sourceOf: (copy) => copy.userData.sourceMesh,
        flipped: showBlendCopy,
      });
      lighting.update();
    }
    const selected = selectVisiblePages(roots, gate.cam, selectOptions, shown);
    state.visible = selected.visible;
    state.selectedTriangles = selected.selectedTriangles;
    state.frustumRejected = selected.frustumRejected;
    state.lodLevel = selected.lodLevel;
    // A search with a finer step left owes an image: the next one is not held on this one. A view
    // that moved in this image already breaks the hold, and forces nothing more.
    const view = gate.revisions.view;
    if (pool.settling && view === viewSeen) gate.resourcesChanged();
    viewSeen = view;
    state.overBudget = attachedPages(shown) > cap;
    if (state.overBudget) {
      shown.length = 0;
      for (let i = 0; i < bootstrap.length; i++) shown.push(bootstrap[i]);
    }
    sync();
    keptChanged();
    // The pages this cut left can go, once the pool holds more than its budget.
    pool.trim();
    gate.keep(state.visible, state.selectedTriangles, shown, state.lodLevel, state.overBudget);
  };
  return {
    frame,
    /** Fixes the pool's search on the last view, one cut an image, at most `MAX_SEARCH_STEPS`:
     *  `awaitPages` then loads the pages of the fixed cut. */
    settle() {
      for (let image = 0; lastCamera && pool.settling && image < MAX_SEARCH_STEPS; image++)
        frame(lastCamera);
    },
  };
}
