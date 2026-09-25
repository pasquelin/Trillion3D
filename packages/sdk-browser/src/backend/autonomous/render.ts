import type { ClusterRoot, PageRec } from '../../page/selection/selection.ts';
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
import { createImageCut } from './imageCut.ts';
import type { createAutonomousResidency } from './residency.ts';

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
  /** The cut drawn, the cut wanted and what the image asks the pool for (`imageCut.ts`). */
  shown: PageRec[];
  desired: PageRec[];
  requested: PageRec[];
  /** Moves when the placements change. */
  revision: () => number;
  /** The display graph's page ceiling, which the cover it pins may raise (`pages.ts`). */
  ceiling: () => number;
  sync: () => void;
  /** What the image keeps is gathered again once it drew another cut; `askedUrls` is all of it
   *  but that cut, what the pool keeps as the next one is about to run (`residency.ts`). */
  residency: Pick<ReturnType<typeof createAutonomousResidency>, 'keptChanged' | 'askedUrls'>;
  /** The geometry pool: what it admits of the requests, and the shedding of what the image no
   *  longer asks for (`pool.ts`). */
  pool: Pick<ReturnType<typeof createGeometryBudget>, 'admit' | 'fit' | 'held' | 'trim'>;
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
    ceiling,
    sync,
    residency,
    pool,
  } = options;
  const motion: CameraMotion = {};
  const cut = createImageCut({ ...options, viewport: context.viewport });
  const sourcesDessinees = roots.map((root) => root.pages[0]);
  const frame = (camera: HostCamera) => {
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
    // Over the budget, the pages the last image drew but no longer asks for can go: this cut
    // draws their nearest resident ancestor, before the scene is drawn again. A pool drawn since
    // the last cut first cuts what it asked for, so the image that sees it holds no more.
    if (cut.readmit()) residency.keptChanged();
    pool.trim(residency.askedUrls);
    const selected = cut(gate.cam, gate.pixelError);
    state.visible = selected.visible;
    state.selectedTriangles = selected.selectedTriangles;
    state.frustumRejected = selected.frustumRejected;
    state.lodLevel = selected.lodLevel;
    // Drawn pages past the display graph's page ceiling are reported, never replaced.
    state.overBudget = attachedPages(shown) > ceiling();
    sync();
    residency.keptChanged();
    gate.keep(state.visible, state.selectedTriangles, shown, state.lodLevel, state.overBudget);
  };
  return Object.assign(frame, { hostBytes: cut.hostBytes });
}
