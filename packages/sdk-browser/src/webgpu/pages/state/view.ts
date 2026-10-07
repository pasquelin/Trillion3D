import { createEngineCamera, type EngineCamera } from '../../../camera/world.ts'
import type { ViewHold } from '../../../frame/viewRevision.ts'
import type { HizPyramid } from '../../../gpu/hiz/types.ts'
import type { PresentRect } from '../../../gpu/core/presentAt.ts'
import type { CutDelta } from '../../cut/delta.ts'
import type { GpuCut } from '../../../gpu/core/selection.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { createWebgpuGpuState, type WebgpuGpuState } from './gpu.ts'
import { createWebgpuRunState, type WebgpuRunState } from './run.ts'
import { createWebgpuVisState, type WebgpuVisState } from './vis.ts'

/**
 * What one camera owns in the runtime groups: the cut it draws and what its image made of it, its
 * motion, its occlusion history, its frame targets, their temporal history and effect chain.
 * Everything else is the scene's and every view shares it: the gate's scene and resource revisions
 * (so an invalidation reaches every view), the GPU cut's tables (each view cuts there with uniforms
 * and lists of its own, `../../../gpu/dag/aside.ts`), the row cache, the residency sets,
 * which ask for the union of the views' cuts under the one page budget
 * (`../../cut/publication.ts`), the pools, the pipelines and the Hi-Z programs, whose pyramid is
 * each view's own (`WebgpuView.hiz`).
 */
export const VIEW_RUN_KEYS = [
  'lastCamera',
  'motion',
  'desired',
  'shown',
  'drawn',
  // The packed rank of each page of the three lists above, parallel to them.
  'desiredPacked',
  'shownPacked',
  'drawnPacked',
  'drawnMirrorsShown',
  'noOccluderHistory',
  'hizViewMoved',
  'previousHizView',
  'temporalHizState',
  'occluderSignature',
  'cutHeld',
  'gpuMetricsReady',
  'overBudget',
  'visible',
  'selectedTriangles',
  'submittedTriangles',
  'drawnTriangles',
  'frustumRejected',
  'lodLevel',
  'selectionUniforms',
  'asideCut',
] as const satisfies readonly (keyof WebgpuRunState)[]
export const VIEW_GPU_KEYS = [
  'colorTexture',
  'colorView',
  'depthTexture',
  'depthView',
  'hdrTexture',
  'hdrView',
  'displayTexture',
  'displayView',
  'feedbackTexture',
  'feedbackView',
  'backdrop',
  'reflection',
  'surfaces',
  'targetSize',
  'allocatedSize',
  'displaySize',
  'targetBytes',
  'targetGrant',
  'temporal',
  'effects',
  'effectsRevision',
] as const satisfies readonly (keyof WebgpuGpuState)[]
export const VIEW_VIS_KEYS = [
  'visTexture',
  'visView',
  'gpuRaster',
] as const satisfies readonly (keyof WebgpuVisState)[]

type RunKey = (typeof VIEW_RUN_KEYS)[number]
type GpuKey = (typeof VIEW_GPU_KEYS)[number]
type VisKey = (typeof VIEW_VIS_KEYS)[number]

/** One view's record: while it is drawn its state lives in the runtime groups, and its record
 *  holds it again as soon as another view is drawn. */
export interface WebgpuView {
  /** The main view's is the host's own array, which a resize writes; while another view is drawn
   *  the host keeps writing it here, never into the drawn view's. */
  viewport: [number, number]
  /** The engine camera frame entry writes (`rt.run.gate.cam`). */
  cam: EngineCamera
  /** Its held-frame witness, and its Hi-Z pyramid, while another view is drawn: the gate and the
   *  shared Hi-Z programs hold the drawn view's (`./viewSwitch.ts`). */
  hold?: ViewHold
  hiz?: HizPyramid
  /** Where a persistent view presents on the canvas (`./persistentView.ts`); the main view and a
   *  capture have none. */
  rect?: PresentRect
  run: Pick<WebgpuRunState, RunKey>
  gpu: Pick<WebgpuGpuState, GpuKey>
  vis: Pick<WebgpuVisState, VisKey>
  /** The differences the view publishes its cut by (`../../cut/publication.ts`): the main view's
   *  are the publication's own, another view's are made at its first cut and emptied when it is
   *  released. */
  cut?: ViewCut
}

/** The cut a view asks for and the one it draws, published by differences into the shared sets,
 *  and the readback it last adopted, whose requests admission ranks. */
export interface ViewCut {
  asked: CutDelta
  drawn: CutDelta
  adopted?: GpuCut
}

/** The runtime's views: the one it opened on, the one its groups hold now, and those drawn beside
 *  the main one every frame. */
export interface WebgpuViews {
  main: WebgpuView
  active: WebgpuView
  persistent: WebgpuView[]
}

function pick<T, K extends keyof T>(from: T, keys: readonly K[]) {
  const picked = {} as Pick<T, K>
  for (const key of keys) picked[key] = from[key]
  return picked
}

/** A view of `width × height` that has drawn nothing yet: no targets, no history, no temporal
 *  pass — a view drawn without accumulation, as a capture is. */
export function createWebgpuView(width: number, height: number): WebgpuView {
  const viewport: [number, number] = [width, height]
  return {
    viewport,
    cam: createEngineCamera(),
    run: pick(createWebgpuRunState(), VIEW_RUN_KEYS),
    gpu: pick(createWebgpuGpuState(viewport), VIEW_GPU_KEYS),
    vis: pick(createWebgpuVisState(), VIEW_VIS_KEYS),
  }
}

/** The main view: its state is the runtime's own, held there from construction. */
export function createWebgpuViews(rt: Pick<WebgpuPagesRuntime, 'run' | 'gpu' | 'vis' | 'setup'>) {
  const main: WebgpuView = {
    viewport: rt.setup.viewport,
    cam: rt.run.gate.cam,
    run: pick(rt.run, VIEW_RUN_KEYS),
    gpu: pick(rt.gpu, VIEW_GPU_KEYS),
    vis: pick(rt.vis, VIEW_VIS_KEYS),
  }
  return { main, active: main, persistent: [] } satisfies WebgpuViews
}

/** `view`'s share of the GPU group, wherever it is held now: the runtime's while it is drawn. */
export const viewGpu = (rt: Pick<WebgpuPagesRuntime, 'gpu' | 'views'>, view: WebgpuView) =>
  rt.views.active === view ? rt.gpu : view.gpu

/** The main view's share of the GPU group: a session-wide pass such as temporal antialiasing is
 *  rigged for the main view, never for a capture drawn aside. */
export const mainViewGpu = (rt: Pick<WebgpuPagesRuntime, 'gpu' | 'views'>) =>
  viewGpu(rt, rt.views.main)

/** The drawn view's image is out of date: the main view's by the shared resource revision, as
 *  before any other view existed; another view's by its own hold alone, the main one kept. */
export function drawnViewChanged(rt: Pick<WebgpuPagesRuntime, 'run' | 'views'>) {
  if (rt.views.active === rt.views.main) rt.run.gate.resourcesChanged()
  else rt.run.gate.viewReplaced()
}
