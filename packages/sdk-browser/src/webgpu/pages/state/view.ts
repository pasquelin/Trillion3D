import { createEngineCamera, type EngineCamera } from '../../../camera/world.ts';
import type { CutDelta } from '../../cut/delta.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { createWebgpuGpuState, type WebgpuGpuState } from './gpu.ts';
import { createWebgpuRunState, type WebgpuRunState } from './run.ts';
import { createWebgpuVisState, type WebgpuVisState } from './vis.ts';

/**
 * What one camera owns in the runtime groups: the cut it draws, its motion, its occlusion history,
 * its frame targets and their temporal history. Everything else is the scene's and every view
 * shares it: the gate's revisions (so an invalidation reaches every view), the GPU cut (the main
 * view's alone), the residency sets, which ask for the union of the views' cuts under the one page
 * budget (`../../cut/publication.ts`), the pools, the pipelines and the Hi-Z pyramid, which follows
 * the drawn view's size.
 */
export const VIEW_RUN_KEYS = [
  'lastCamera',
  'motion',
  'desired',
  'shown',
  'drawn',
  'drawnMirrorsShown',
  'selectResult',
  'noOccluderHistory',
  'hizViewMoved',
  'previousHizView',
  'temporalHizState',
  'cpuHizCounts',
  'cpuHizCounted',
  'occluderSignature',
] as const satisfies readonly (keyof WebgpuRunState)[];
export const VIEW_GPU_KEYS = [
  'colorTexture',
  'colorView',
  'depthTexture',
  'depthView',
  'hdrTexture',
  'hdrView',
  'feedbackTexture',
  'feedbackView',
  'backdrop',
  'reflection',
  'surfaces',
  'targetSize',
  'targetBytes',
  'targetGrant',
  'temporal',
] as const satisfies readonly (keyof WebgpuGpuState)[];
export const VIEW_VIS_KEYS = [
  'visTexture',
  'visView',
  'materialDepthTexture',
  'materialDepthView',
  'gpuRaster',
] as const satisfies readonly (keyof WebgpuVisState)[];

type RunKey = (typeof VIEW_RUN_KEYS)[number];
type GpuKey = (typeof VIEW_GPU_KEYS)[number];
type VisKey = (typeof VIEW_VIS_KEYS)[number];

/** One view's record: while it is drawn its state lives in the runtime groups, and its record
 *  holds it again as soon as another view is drawn. */
export interface WebgpuView {
  /** The main view's is the host's own array, which a resize writes; while another view is drawn
   *  the host keeps writing it here, never into the drawn view's. */
  viewport: [number, number];
  /** The engine camera frame entry writes (`rt.run.gate.cam`). */
  cam: EngineCamera;
  run: Pick<WebgpuRunState, RunKey>;
  gpu: Pick<WebgpuGpuState, GpuKey>;
  vis: Pick<WebgpuVisState, VisKey>;
  /** The differences the view publishes its cut by (`../../cut/publication.ts`): the main view's
   *  are the publication's own, another view's are made at its first cut and emptied when it is
   *  released. */
  cut?: ViewCut;
}

/** The cut a view asks for and the one it draws, published by differences into the shared sets. */
export interface ViewCut {
  asked: CutDelta;
  drawn: CutDelta;
}

/** The runtime's views: the one it opened on, and the one its groups hold now. */
export interface WebgpuViews {
  main: WebgpuView;
  active: WebgpuView;
}

function pick<T, K extends keyof T>(from: T, keys: readonly K[]) {
  const picked = {} as Pick<T, K>;
  for (const key of keys) picked[key] = from[key];
  return picked;
}

/** A view of `width × height` that has drawn nothing yet: no targets, no history, no temporal
 *  pass — a view added before step C of #412 draws unaccumulated, as a capture does. */
export function createWebgpuView(width: number, height: number): WebgpuView {
  const viewport: [number, number] = [width, height];
  return {
    viewport,
    cam: createEngineCamera(),
    run: pick(createWebgpuRunState(), VIEW_RUN_KEYS),
    gpu: pick(createWebgpuGpuState(viewport), VIEW_GPU_KEYS),
    vis: pick(createWebgpuVisState(), VIEW_VIS_KEYS),
  };
}

/** The main view: its state is the runtime's own, held there from construction. */
export function createWebgpuViews(rt: Pick<WebgpuPagesRuntime, 'run' | 'gpu' | 'vis' | 'setup'>) {
  const main: WebgpuView = {
    viewport: rt.setup.viewport,
    cam: rt.run.gate.cam,
    run: pick(rt.run, VIEW_RUN_KEYS),
    gpu: pick(rt.gpu, VIEW_GPU_KEYS),
    vis: pick(rt.vis, VIEW_VIS_KEYS),
  };
  return { main, active: main } satisfies WebgpuViews;
}

/** The main view's share of the GPU group, wherever it is held now: a session-wide pass such as
 *  temporal antialiasing is rigged for the main view, never for a capture drawn aside. */
export function mainViewGpu(rt: Pick<WebgpuPagesRuntime, 'gpu' | 'views'>) {
  const { views } = rt;
  return views.active === views.main ? rt.gpu : views.main.gpu;
}
