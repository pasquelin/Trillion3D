import type { ClusterRoot, PageRec } from '../../page/selection/selection.ts';
import type { BackendContext } from '../types.ts';
import type { installSceneLighting } from '../../lighting/sceneLighting.ts';
import type { WebglFrameGate } from '../../webgl/core/frameGate.ts';
import type { HostCamera } from '../../camera/world.ts';
import type { HostWorldPlacements } from '../../host/world/placements.ts';
import type { BlendCopy } from '../../cluster/blendCopyContract.ts';
import { showBlendCopy } from '../../cluster/blendCopyMesh.ts';
import { attachedPages } from '../../placement/autonomousPlacements.ts';
import { followHostVisibility } from '../../placement/hidden.ts';
import type { createGeometryBudget } from './pool.ts';
import { createImageCut } from './imageCut.ts';
import { createRefusalAnswer } from './refusals.ts';
import type { createAutonomousResidency } from './residency.ts';
import type { createAutonomousGeometry } from './geometry.ts';
import type { WebglViewState } from './views.ts';

/** What the autonomous frame decided, and whether it was held. */
export type AutonomousRenderState = {
  visible: number;
  /** The cut's triangle counts under their metric names, spread into `metrics()`. */
  triangles: { selectedTriangles: number; drawnTriangles: number; uncoveredTriangles: number };
  frustumRejected: number;
  lodLevel: number;
  overBudget: boolean;
  frameHeld: boolean;
};

export const createAutonomousRenderState = (): AutonomousRenderState => ({
  visible: 0,
  triangles: { selectedTriangles: 0, drawnTriangles: 0, uncoveredTriangles: 0 },
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
  /** The drawn view: the cut drawn, the cut wanted, what the image asks the pool for
   *  (`imageCut.ts`), its motion and its size, read at each frame (`views.ts`). */
  view: WebglViewState;
  /** Moves when the placements change. */
  revision: () => number;
  /** The display graph's page ceiling, which the cover it pins may raise (`pages.ts`). */
  ceiling: () => number;
  /** The page store: the image's pages attach there, and its loads and releases move the cut's
   *  readiness (`geometry.ts`). */
  geometry: Pick<ReturnType<typeof createAutonomousGeometry>, 'sync' | 'held'>;
  /** What the image keeps is gathered again once it drew another cut (`residency.ts`). */
  residency: Pick<ReturnType<typeof createAutonomousResidency>, 'keptChanged'>;
  /** The geometry pool: what it admits of the requests, what it holds of what the image asks for
   *  and draws, and the shedding of what it no longer holds (`pool.ts`). */
  pool: Pick<
    ReturnType<typeof createGeometryBudget>,
    'admit' | 'fit' | 'held' | 'follow' | 'trim' | 'outOfMemory'
  >;
}) {
  const {
    state,
    context,
    gate,
    lighting,
    roots,
    blendCopies,
    worlds,
    view,
    ceiling,
    geometry,
    residency,
    pool,
  } = options;
  const cut = createImageCut({ ...options, held: geometry.held });
  const sourcesDessinees = roots.map((root) => root.pages[0]);
  /** What the image asks for and draws moved: the streamer's pins and the pool follow it. */
  const follow = () => {
    residency.keptChanged();
    pool.follow(view.requested, view.shown);
  };
  const answerRefusals = createRefusalAnswer({
    gl: () => context.webglContext,
    pool,
    onDiagnostic: context.onDiagnostic,
    redraw: () => gate.resourcesChanged(),
  });
  const frame = (camera: HostCamera) => {
    // The allocations the context refused since the last frame, answered first (`refusals.ts`).
    answerRefusals();
    // Frame entry: the order and its guarantees live in `../../frame/gateCore.ts`, which also copies
    // the host camera into the engine camera — the cut now reads only the latter.
    state.frameHeld = gate.enterFrame(
      context,
      camera,
      view.motion,
      view.viewport,
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
    // Over the budget, the pages the last image drew but the pool no longer holds can go: this cut
    // draws their nearest resident ancestor, before the scene is drawn again. A pool drawn since
    // the last cut first cuts what it asked for, so the image that sees it holds no more.
    if (cut.readmit()) follow();
    pool.trim();
    const selected = cut(gate.cam, gate.pixelError);
    state.visible = selected.visible;
    const { triangles } = state;
    triangles.selectedTriangles = selected.selectedTriangles;
    triangles.drawnTriangles = selected.displayedTriangles;
    triangles.uncoveredTriangles = selected.uncoveredTriangles;
    state.frustumRejected = selected.frustumRejected;
    state.lodLevel = selected.lodLevel;
    // Drawn pages past the display graph's page ceiling are reported, never replaced.
    state.overBudget = attachedPages(view.shown, roots) > ceiling();
    geometry.sync();
    follow();
    gate.keep(
      state.visible,
      triangles.selectedTriangles,
      view.shown,
      state.lodLevel,
      state.overBudget,
    );
  };
  return Object.assign(frame, { hostBytes: cut.hostBytes });
}
