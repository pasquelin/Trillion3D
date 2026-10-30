import { createEngineCamera, type EngineCamera } from '../../../camera/engineCamera.ts'
import type { ViewHold } from '../../view/viewRevision.ts'
import type { HizPyramid } from '../../../visibility/hiz/gpu/types.ts'
import type { PresentRect } from '../../../gpu/core/presentAt.ts'
import type { CutDelta } from '../../../geometry/cut/adoption/delta.ts'
import type { GpuCut } from '../../../gpu/core/selection.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { createWebgpuGpuState, type WebgpuGpuState } from './gpu.ts'
import { createWebgpuRunState } from './runState.ts'
import type { WebgpuRunState } from './run.ts'
import { createWebgpuVisState, type WebgpuVisState } from './vis.ts'
import { createWebgpuTimingState, type WebgpuTimingState } from './timing.ts'
import type { ViewFrameMetrics } from '../../../../../sdk-core/src/contracts/metrics.ts'
import { createViewScale, type ViewScale } from '../../view/viewScale.ts'
import type { ScaleControl } from '../../scale/scaleControl.ts'
import { NO_OVERRIDES, type ViewOverrides } from './viewOverrides.ts'

/**
 * What one camera owns in the runtime groups: the cut it draws and what its image made of it, its
 * occlusion history, its frame targets, their temporal history and effect chain, the canvas it
 * presents into, its GPU timer and its render scale. Everything else is the scene's and
 * every view shares it: the gate's scene and resource revisions (so an invalidation reaches every
 * view), the GPU cut's tables (each view cuts there with uniforms and lists of its own,
 * `../../../geometry/dag/aside.ts`), the row cache, the residency sets, which ask for the union of the
 * views' cuts under the one page budget (`../../../geometry/cut/adoption/publication.ts`), the pools, the pipelines and
 * the Hi-Z programs, whose pyramid is each view's own (`WebgpuView.hiz`).
 */
export const VIEW_RUN_KEYS = [
  'lastCamera',
  'desired',
  'shown',
  // The packed rank of each page of the two lists above, parallel to them.
  'desiredPacked',
  'shownPacked',
  'noOccluderHistory',
  'cutHeld',
  'gpuMetricsReady',
  'overBudget',
  'visible',
  'selectedTriangles',
  'submittedTriangles',
  'frustumRejected',
  // The blended items the view's own frustum rejected (`prepareBlend`).
  'blendFrustumRejected',
  'lodLevel',
  'occluded',
  'postHidden',
  'selectionUniforms',
  'asideCut',
] as const satisfies readonly (keyof WebgpuRunState)[]
/** The frame targets' members of the GPU group: what a view holds and what a target set made
 *  beside the runtime's (`../../prepare/targetsSet.ts`) trades whole. */
export const TARGET_GPU_KEYS = [
  'colorTexture',
  'colorView',
  'depthTexture',
  'depthView',
  'hdrTexture',
  'hdrView',
  'displayTexture',
  'displayView',
  'canvasOnly',
  'feedbackTexture',
  'feedbackView',
  'backdrop',
  'translucency',
  'reflection',
  'surfaces',
  'targetSize',
  'allocatedSize',
  'displaySize',
  'targetBytes',
  // The clouds' images are drawn at the render size, and go with the targets of that size.
  'clouds',
] as const satisfies readonly (keyof WebgpuGpuState)[]
export const VIEW_GPU_KEYS = [
  ...TARGET_GPU_KEYS,
  'targetGrant',
  'temporal',
  'temporalLevel',
  'exposure',
  'finish',
  'effects',
  'effectsRevision',
  // The reading of the effect kinds' settings, one per view (`createKindSettings`): what moved since
  // the image before is the view's own.
  'kindSettings',
  // The images the passes after the lighting hand on, which `canvasOnly` keeps: the view's own.
  'images',
  // The velocity stage, the screen probes and the ambient occlusion, whose histories follow the
  // camera of the view that drew them.
  'velocity',
  'screenProbes',
  'ambientOcclusion',
  'subsurface',
  // The fog's volume and its history, which follow the camera of the view that built them.
  'fogVolume',
  // The translucency lighting volume and its history, which follow the camera of the view that built them.
  'translucencyVolume',
  // The translucency global illumination volume and its history, which follow the camera of the view that built them.
  'translucencyGi',
  // The lists of the local fog volumes, made for the view's tiles.
  'localFog',
  // The light shafts' histories, which follow the camera of the view that drew them.
  'lightShafts',
  // The hair strands' visibility and macro groups, which follow the camera of the view that built
  // them.
  'hair',
  // The key the view's own states are kept under (`./viewKey.ts`).
  'viewKey',
  // The canvas the view presents into: the main view's, or one of its own (`./persistentView.ts`).
  'presenter',
] as const satisfies readonly (keyof WebgpuGpuState)[]
export const VIEW_VIS_KEYS = [
  'visTexture',
  'visView',
  'gpuRaster',
] as const satisfies readonly (keyof WebgpuVisState)[]

/** A view's GPU timer and what its samples said last (`../../prepare/timing.ts`). */
export const VIEW_TIMING_KEYS = [
  'gpuTiming',
  'lastGpuPassMs',
  'lastGpuFrameMs',
  'lastGpuHostGapMs',
  'lastGpuIdleMs',
] as const satisfies readonly (keyof WebgpuTimingState)[]

type RunKey = (typeof VIEW_RUN_KEYS)[number]
type GpuKey = (typeof VIEW_GPU_KEYS)[number]
type VisKey = (typeof VIEW_VIS_KEYS)[number]
type TimingKey = (typeof VIEW_TIMING_KEYS)[number]

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
  /** What a cache kept per view keys it by — its suns' shadow clipmaps among them
   *  (`../../../lighting/shadows/vsm/cacheManager.ts`): a persistent view's own; the main view and a capture, which
   *  draws from the main view's, share `''`. */
  readonly id: string
  run: Pick<WebgpuRunState, RunKey>
  gpu: Pick<WebgpuGpuState, GpuKey>
  vis: Pick<WebgpuVisState, VisKey>
  timing: Pick<WebgpuTimingState, TimingKey>
  /** Its viewport's size as a key (`renderScale.ts`, `viewKey`), made when it changes. */
  sizeKey?: { width: number; height: number; text: string }
  /** The scale it is drawn at, never traded: the main view's is the world's controller
   *  (`WebgpuViews.main`); the drawn view's is read through `views.active.scale`. */
  scale: ViewScale
  /** What the view turns off or forces in its passes (`./viewOverrides.ts`): a capture's, else
   *  none; read through `views.active.overrides`, never traded with the groups. */
  overrides: ViewOverrides
  /** The differences the view publishes its cut by (`../../../geometry/cut/adoption/publication.ts`): the main view's
   *  are the publication's own, another view's are made at its first cut and emptied when it is
   *  released. */
  cut?: ViewCut
  /** A persistent view's draws: the main images between its last two (`every`), the main image
   *  it was last drawn beside (`drawnBeside`) — its share of the frame's budget
   *  (`../../prepare/timing.ts`) —, and its last image's metrics (`./persistentView.ts`). */
  every?: number
  drawnBeside?: number
  metrics?: ViewFrameMetrics
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
  /** Its scale is the world's controller: the render scale the page asked, its cadence and the
   *  budget every view's GPU time is fitted to. */
  main: WebgpuView & { scale: ScaleControl }
  active: WebgpuView
  persistent: WebgpuView[]
  /** The main view's images so far: the clock a persistent view's share is counted on. */
  mainImages: number
}

function pick<T, K extends keyof T>(from: T, keys: readonly K[]) {
  const picked = {} as Pick<T, K>
  for (const key of keys) picked[key] = from[key]
  return picked
}

/** The views made with an identity of their own so far. */
let ownViews = 0

/** A view of `width × height` that has drawn nothing yet: no targets, no history, no temporal
 *  pass, no timer, no canvas of its own, at the display's scale — a view drawn without
 *  accumulation, as a capture is. `own`, it keeps its per-view caches under an identity of its
 *  own (`WebgpuView.id`); else the main view's. `overrides`, what its passes turn off or force. */
export function createWebgpuView(
  width: number,
  height: number,
  scale: ViewScale = createViewScale(1, { wanted: () => 1 }),
  own = false,
  overrides: ViewOverrides = NO_OVERRIDES,
): WebgpuView {
  const viewport: [number, number] = [width, height]
  const gpu = pick(createWebgpuGpuState(viewport), VIEW_GPU_KEYS)
  gpu.temporalLevel = 'off'
  return {
    id: own ? `view${++ownViews}` : '',
    viewport,
    cam: createEngineCamera(),
    run: pick(createWebgpuRunState(), VIEW_RUN_KEYS),
    gpu,
    vis: pick(createWebgpuVisState(), VIEW_VIS_KEYS),
    timing: pick(createWebgpuTimingState(), VIEW_TIMING_KEYS),
    scale,
    overrides,
  }
}

/** The main view: its state is the runtime's own, held there from construction. */
export function createWebgpuViews(
  rt: Pick<WebgpuPagesRuntime, 'run' | 'gpu' | 'vis' | 'setup' | 'timing'>,
  scale: ScaleControl,
) {
  const main: WebgpuViews['main'] = {
    id: '',
    viewport: rt.setup.viewport,
    cam: rt.run.gate.cam,
    run: pick(rt.run, VIEW_RUN_KEYS),
    gpu: pick(rt.gpu, VIEW_GPU_KEYS),
    vis: pick(rt.vis, VIEW_VIS_KEYS),
    timing: pick(rt.timing, VIEW_TIMING_KEYS),
    scale,
    overrides: NO_OVERRIDES,
  }
  return { main, active: main, persistent: [], mainImages: 0 } satisfies WebgpuViews
}

/** The runtime groups a view holds a share of. */
type ViewGroup = 'run' | 'gpu' | 'vis' | 'timing'

/** `view`'s share of runtime group `group`, wherever it is held now: the runtime's while it is
 *  drawn. */
export const viewGroup = <G extends ViewGroup>(
  rt: Pick<WebgpuPagesRuntime, G | 'views'>,
  view: WebgpuView,
  group: G,
): WebgpuView[G] =>
  // The runtime's group holds every key of the view's share.
  rt.views.active === view ? (rt[group] as WebgpuView[G]) : view[group]

/** `view`'s share of the GPU group (`viewGroup`). */
export const viewGpu = (rt: Pick<WebgpuPagesRuntime, 'gpu' | 'views'>, view: WebgpuView) =>
  viewGroup(rt, view, 'gpu')

/** The main view's share of the GPU group: a session-wide pass such as temporal antialiasing is
 *  rigged for the main view, never for a capture drawn aside. */
export const mainViewGpu = (rt: Pick<WebgpuPagesRuntime, 'gpu' | 'views'>) =>
  viewGpu(rt, rt.views.main)

/** Breaks the held frame of `view`, the drawn view or one drawn aside: its next draw is not held. The
 *  drawn view's goes through the gate's view revision; a view aside holds its own (`useViewHold`),
 *  which a move breaks. The scene's boxes and culls and the view's image history stand. */
export function breakHeldFrame(rt: Pick<WebgpuPagesRuntime, 'run' | 'views'>, view: WebgpuView) {
  if (view === rt.views.active) rt.run.gate.viewReplaced()
  else if (view.hold) view.hold.view++
}

/** After a view drawn aside rendered: breaks the main view's hold when that view drew an image (not one held, nor one it waited for) and
 *  `composited` — the main view composites what it drew (a mirror, the cube of the sky meshes once it is read). Whether it did. */
export function breakMainHeld(rt: Pick<WebgpuPagesRuntime, 'run' | 'views'>, composited = true) {
  if (!composited || rt.run.frameHeld || rt.run.heldEmpty) return false
  breakHeldFrame(rt, rt.views.main)
  return true
}

/** The drawn view's image is out of date: the main view's by the shared resource revision, as
 *  before any other view existed; another view's by its own hold alone, the main one kept. */
export function drawnViewChanged(rt: Pick<WebgpuPagesRuntime, 'run' | 'views'>) {
  if (rt.views.active === rt.views.main) rt.run.gate.resourcesChanged()
  else rt.run.gate.viewReplaced()
}
