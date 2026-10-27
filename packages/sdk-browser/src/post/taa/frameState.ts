import { NO_CAMERA, type CameraImage } from '../../frame/backend/state/previousCamera.ts'
import { TAA_SAMPLES } from './jitter.ts'
import { createFrameRing, planFrame, type FrameRing, type FrameSlices } from './historyFrames.ts'

/** What the temporal pass keeps from one image to the next on the CPU side. */
export interface TaaFrameState {
  /** Jitter rank of the next accumulated image; only advances on those, over `phases`. */
  sample: number
  /** Lighting sample rank, independent of the spatial jitter cycle; owned by this view. It advances once per image
   *  drawn, at its entry (`beginTaaFrame`), whether it accumulates or not. A held image and a capture drawn aside with no pass
   *  of its own leave it as it is. */
  stochasticSample: number
  /** Jitter phases of the frame's render-to-display ratio (`upscalePhases`): eleven at native size. */
  phases: number
  /** This image's jitter, in the pixels it is drawn in. */
  jitter: Float64Array
  /** Those pixels, `(width, height)`, as the image's entry read them: the grid the render matrices'
   *  clip offset divides the jitter by (`jitterViewProjection`). */
  jitterGrid: Float64Array
  /** Render view-projection of this image, jitter included: what the raster, shading, blend and
   *  the partition read, decided once at image entry. */
  viewProjection: Float64Array
  /** The number of the last image kept (`keepImage`): the view's camera of the image before — its view-projection without
   *  jitter and its eye, which the history describes and the camera's move since is told by — is this history's where that
   *  is its image (`before`, `cameraSeen`); a history that skipped an image starts again, as after a cut. */
  seen: number
  /** The camera of the history's image, set once an image by the velocity stage (`encodeVelocity`): none, zeros, where the
   *  history holds none. */
  before: CameraImage
  /** The render grid that image was drawn in, `(width, height)`: the render-resolution histories'
   *  viewport (`analysis.ts`). */
  previousRender: Float64Array
  hasHistory: boolean
  /** The frames the history keeps and the walk over them (`historyFrames.ts`): replaced with the
   *  history when it is made as another shape (`resize`). */
  ring: FrameRing
  /** The slots the image being drawn reads and writes, planned at its entry (`planFrame`). */
  slices: FrameSlices
  /** The history's size over the display's per axis, 1 to 2 (`historyShape.ts`): what the sample
   *  laws and the convergence are counted in. */
  historyScale: number
  /** Images accumulated, the view still, since the history was last dropped (`dropTaaHistory`) or
   *  the image last moved — the camera, a placement, a deformation, the scene or its resources —:
   *  how converged a still view is (`taaConverged`). A moving history keeps fewer samples than a
   *  still one (`historySampleLaws`), so motion restarts the count. */
  accumulated: number
  /** Resources revision of the last accumulated image: another one restarts `accumulated`. */
  resourcesSeen: number
  /** Whether the last accumulated image ran the flicker measure: one that runs it after an image
   *  that did not drops the history, its flicker history unwritten meanwhile (`encodeTaaPass`). */
  flickerRan: boolean
  /** Whether the last accumulated image ran the thin geometry detection: one that runs it after
   *  an image that did not drops the history, its coverage history unwritten meanwhile. */
  thinRan: boolean
  /** Explicit discontinuity revision of this view, independent of ordinary camera motion. */
  viewSeen: number
  /** Scene revision of the last accumulated image: another one causes poses to be compared. */
  sceneSeen: number
  /** True when the current image accumulates: rendered with jitter, resolved by the pass. */
  active: boolean
  /** Whether this image draws the surfaces that name a displacement tessellated
   *  (`tessellationWanted`), decided once by the velocity stage (`encodeVelocity`): the velocity passes then run their displaced
   *  pipelines, which solve a displaced texel's flat point (`DISPLACED`, `deformWgsl.ts`). */
  tessellated: boolean
}

export function createTaaFrameState(): TaaFrameState {
  const ring = createFrameRing()
  return {
    sample: 0,
    stochasticSample: 0,
    phases: TAA_SAMPLES,
    jitter: new Float64Array(2),
    jitterGrid: new Float64Array(2),
    viewProjection: new Float64Array(16),
    seen: 0,
    before: NO_CAMERA,
    previousRender: new Float64Array(2),
    hasHistory: false,
    ring,
    slices: planFrame(ring, false),
    historyScale: 1,
    accumulated: 0,
    resourcesSeen: -1,
    flickerRan: false,
    thinRan: false,
    sceneSeen: -1,
    viewSeen: -1,
    active: false,
    tessellated: false,
  }
}

/** The image's stochastic phase, the one the lighting's noise turns with (the deferred view's
 *  `jitter.w`, `jitterWords.ts`): the view's count of images drawn (`stochasticSample`), accumulated
 *  or not, so a view without the temporal accumulation meets a new noise at each image. */
export const stochasticPhase = (taa: TaaFrameState | undefined) => taa?.stochasticSample ?? 0

/** Slots of the resolve's stochastic pattern (`writeTaaView`): the accumulated image's own rank
 *  modulo them. */
const STOCHASTIC_SLOTS = 8
export const stochasticSlot = (taa: TaaFrameState) => taa.stochasticSample % STOCHASTIC_SLOTS
