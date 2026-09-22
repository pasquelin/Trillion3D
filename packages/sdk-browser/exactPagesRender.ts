import * as THREE from 'three';
import type { HostGraphNode } from './hostGraphNodes.ts';
import {
  createSelectionResult,
  selectVisiblePages,
  type PageRec,
  type ClusterRoot,
} from './pageSelection.ts';
import type { BackendContext } from './backendTypes.ts';
import { lighting } from './hostSceneObjects.ts';
import { createCpuStepProfile } from './cpuProfile.ts';
import { EXACT_CPU_STEP } from './exactPagesCpu.ts';
import type { WebglFrameGate } from './webglFrameGate.ts';
import type { CameraMotion, EngineCamera, HostCamera } from './cameraWorld.ts';
import type { HostWorldPlacements } from './hostWorldPlacements.ts';

export type ExactPagesRenderState = {
  visible: number;
  selectedTriangles: number;
  frame: number;
  overBudget: boolean;
  frustumRejected: number;
  lodLevel: number;
  lastCamera: HostCamera | undefined;
  /** Engine camera, absent as long as no frame has been rendered. */
  cam: EngineCamera | undefined;
  lastPixelError: number;
  /** Time of the cluster cut alone, between the selection call and its return: neither the
   *  adaptive threshold, nor residency, nor ranks, nor submit. */
  cpuSelectMs: number;
  /** Hierarchy nodes the cut popped for this frame. */
  cpuSelectNodesTested: number;
  /** True when the frame was held: no CPU step was executed. */
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
    cam: undefined,
    lastPixelError: 0,
    cpuSelectMs: 0,
    cpuSelectNodesTested: 0,
    frameHeld: false,
  };
}

/** CPU steps of a held frame, reset to zero: the list depends on nothing and is read once,
 *  not every frame of the stationary regime that frame-hold installs. */
const EXACT_CPU_STEPS = Object.values(EXACT_CPU_STEP);

export function createExactPagesRender(options: {
  state: ExactPagesRenderState;
  context: BackendContext;
  source: HostGraphNode;
  blendCopies: THREE.Mesh[];
  sceneLights: ReturnType<typeof lighting>;
  motion: CameraMotion;
  roots: ReadonlyArray<ClusterRoot<PageRec>>;
  /** Engine world-matrix index, rebuilt once per scene revision. */
  worlds: HostWorldPlacements;
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
    worlds,
    viewport,
    cap,
    desired,
    shown,
    syncResident,
    cpuProfile,
    gate,
  } = options;
  // Cut request and result, set once: a render frame allocates nothing at all.
  const selectOptions = {
    pixelError: 0,
    viewport,
    holdResident: true,
    pageBudget: cap,
    wanted: desired,
    result: createSelectionResult<PageRec>(),
  };
  // What this engine draws, by the source node each thing comes from: one page per root —
  // instances of the same model all name it —, and the transparent copies outside the DAG.
  const sourcesDessinees = [
    ...roots.map((root) => root.pages[0]),
    ...blendCopies.map((copy) => copy.userData),
  ];
  /**
   * A held frame has executed no step: its profile says so in zeros, not in estimates, and
   * the cut duration and visited-node count are zero because no cut was run — never those of
   * the last frame that ran one. What the frame SHOWS stays described by the cut it
   * redisplays: retained pages, selected triangles, frustum rejection and detail level do
   * not move, since it is the same cut.
   */
  const heldProfile = () => {
    const row = cpuProfile.row;
    for (const step of EXACT_CPU_STEPS) row[step] = 0;
    state.cpuSelectMs = 0;
    state.cpuSelectNodesTested = 0;
  };
  return (camera: HostCamera) => {
    state.frame++;
    state.lastCamera = camera;
    // Frame entry: the order and its guarantees live in `frameGateCore.ts`, which also copies
    // the host camera into the engine camera. Nothing has moved and the two previous frames
    // produced the same cut: the attached scene is already this frame, and the host redraws
    // it as-is.
    state.frameHeld = gate.enterFrame(context, camera, motion, viewport, source, sourcesDessinees);
    state.lastPixelError = gate.pixelError;
    const cam = (state.cam = gate.cam);
    if (state.frameHeld) return heldProfile();
    const worldStart = performance.now();
    // World matrices are a function of the scene only. Transparent copies have nothing to
    // take back: each carries the world matrix of its source mesh, not a snapshot of it.
    const worldsMoved = gate.updateWorlds(worlds);
    const lightsStart = performance.now();
    // Lights copied into the render scene read only the source graph: same revision.
    if (worldsMoved) sceneLights.update();
    const selectStart = performance.now();
    state.overBudget = false;
    // The cut request is set once and for all: the render frame allocates nothing.
    selectOptions.pixelError = state.lastPixelError;
    // `cpuSelectMs` must say only one thing: the cluster cut. The adaptive threshold and the
    // camera are set before this bound; residency and submit come after.
    const cutStart = performance.now();
    const selected = selectVisiblePages(roots, cam, selectOptions, shown);
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
    // The profile `selectMs` step keeps its wide bounds: the sum of the steps remains the frame.
    row[EXACT_CPU_STEP.selectMs] = syncStart - selectStart;
    row[EXACT_CPU_STEP.syncMs] = syncEnd - syncStart;
    row[EXACT_CPU_STEP.pendingMs] = 0;
    row[EXACT_CPU_STEP.retainMs] = 0;
    row[EXACT_CPU_STEP.submitMs] = 0;
    gate.keep(state.visible, state.selectedTriangles, shown, state.lodLevel, state.overBudget);
  };
}
