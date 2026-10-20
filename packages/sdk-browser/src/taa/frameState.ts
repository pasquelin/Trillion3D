import { TAA_SAMPLES } from './jitter.ts'

/** What the temporal pass keeps from one image to the next on the CPU side. */
export interface TaaFrameState {
  /** Jitter rank of the next accumulated image; only advances on those, over `phases`. */
  sample: number
  /** Lighting sample rank, independent of the spatial jitter cycle; owned by this view. */
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
  /** View-projection WITHOUT jitter of the last accumulated image: what the history describes. */
  previousViewProjection: Float64Array
  /** The eye of that image: the camera's move since, which a point's parallax is told by. */
  previousEye: Float64Array
  /** The render grid that image was drawn in, `(width, height)`: the render-resolution histories'
   *  viewport (`analysis.ts`). */
  previousRender: Float64Array
  /** That image's exposure: the render-resolution histories are kept exposed, and corrected by the
   *  ratio to this image's. */
  previousExposure: number
  hasHistory: boolean
  /** Images accumulated, the view still, since the history was last dropped (`dropTaaHistory`) or
   *  the image last moved — the camera, a placement, a deformation, the scene or its resources —:
   *  how converged a still view is (`taaConverged`). A moving history keeps fewer samples than a
   *  still one (`HISTORY_LAWS`), so motion restarts the count. */
  accumulated: number
  /** Resources revision of the last accumulated image: another one restarts `accumulated`. */
  resourcesSeen: number
  /** Whether the last accumulated image ran the flicker measure: one that runs it after an image
   *  that did not drops the history, its flicker history unwritten meanwhile (`encodeTaaPass`). */
  flickerRan: boolean
  /** Explicit discontinuity revision of this view, independent of ordinary camera motion. */
  viewSeen: number
  /** Scene revision of the last accumulated image: another one causes poses to be compared. */
  sceneSeen: number
  /** True when the current image accumulates: rendered with jitter, resolved by the pass. */
  active: boolean
}

export function createTaaFrameState(): TaaFrameState {
  return {
    sample: 0,
    stochasticSample: 0,
    phases: TAA_SAMPLES,
    jitter: new Float64Array(2),
    jitterGrid: new Float64Array(2),
    viewProjection: new Float64Array(16),
    previousViewProjection: new Float64Array(16),
    previousEye: new Float64Array(3),
    previousRender: new Float64Array(2),
    previousExposure: 1,
    hasHistory: false,
    accumulated: 0,
    resourcesSeen: -1,
    flickerRan: false,
    sceneSeen: -1,
    viewSeen: -1,
    active: false,
  }
}

/** The image's stochastic phase, the one the lighting's noise turns with (the deferred view's
 *  `jitter.w`, `jitterWords.ts`): it advances on accumulated images alone; none without the
 *  temporal accumulation. */
export const stochasticPhase = (taa: TaaFrameState | undefined) =>
  taa?.active ? taa.stochasticSample : 0

/** Slots of the resolve's stochastic pattern (`writeTaaView`): the accumulated image's own rank
 *  modulo them. */
const STOCHASTIC_SLOTS = 8
export const stochasticSlot = (taa: TaaFrameState) => taa.stochasticSample % STOCHASTIC_SLOTS
