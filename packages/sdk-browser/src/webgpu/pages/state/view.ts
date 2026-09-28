import { createEngineCamera, type EngineCamera } from '../../../camera/world.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import { createWebgpuGpuState, type WebgpuGpuState } from './gpu.ts';
import { createWebgpuRunState, type WebgpuRunState } from './run.ts';
import { createWebgpuVisState, type WebgpuVisState } from './vis.ts';

/**
 * What one camera owns in the runtime groups: the cut it draws, its motion, its occlusion history,
 * its frame targets and their temporal history. Everything else is the scene's and every view
 * shares it: the gate's revisions (so an invalidation reaches every view), the GPU cut (the main
 * view's alone), the list the residency is asked for (`desired`, which A2 of #412 makes the union
 * of the views), the pools, the pipelines and the Hi-Z pyramid, which follows the drawn view's size.
 */
export const VIEW_RUN_KEYS = [
  'lastCamera',
  'motion',
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
  viewport: [number, number];
  /** The engine camera frame entry writes (`rt.run.gate.cam`). */
  cam: EngineCamera;
  run: Pick<WebgpuRunState, RunKey>;
  gpu: Pick<WebgpuGpuState, GpuKey>;
  vis: Pick<WebgpuVisState, VisKey>;
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
  const gpu = pick(createWebgpuGpuState(viewport), VIEW_GPU_KEYS);
  gpu.temporal = undefined;
  return {
    viewport,
    cam: createEngineCamera(),
    run: pick(createWebgpuRunState(), VIEW_RUN_KEYS),
    gpu,
    vis: pick(createWebgpuVisState(), VIEW_VIS_KEYS),
  };
}

/** The main view: its state is the runtime's own, held there from construction. */
export function createWebgpuViews(rt: Pick<WebgpuPagesRuntime, 'run' | 'gpu' | 'vis' | 'setup'>) {
  const [width, height] = rt.setup.viewport;
  const main: WebgpuView = {
    viewport: [width, height],
    cam: rt.run.gate.cam,
    run: pick(rt.run, VIEW_RUN_KEYS),
    gpu: pick(rt.gpu, VIEW_GPU_KEYS),
    vis: pick(rt.vis, VIEW_VIS_KEYS),
  };
  return { main, active: main } satisfies WebgpuViews;
}
