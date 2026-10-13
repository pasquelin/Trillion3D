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
  /** The camera's view-projection of this image, WITHOUT jitter: what a reader that must not follow the
   *  sub-pixel offset (the run-time proxy's epoch) tells the view's move by. */
  cameraViewProjection: Float64Array
  /** View-projection WITHOUT jitter of the last accumulated image: what the history describes. */
  previousViewProjection: Float64Array
  /** The eye of that image: the camera's move since, which a point's parallax is told by. */
  previousEye: Float64Array
  hasHistory: boolean
  /** Explicit discontinuity revision of this view, independent of ordinary camera motion. */
  viewSeen: number
  /** Quiet images accumulated in a row; see `taaStillFrames`. Zero as soon as something moves. */
  stillFrames: number
  /** Quiet images drawn into a still average not yet whole (`taaSettled`), counted for good: the
   *  image still arriving, which the interactive loop's settle limit does not spend (`taaArrivals`). */
  stillDrawn: number
  /** Scene revision of the last accumulated image: another one causes poses to be compared. */
  sceneSeen: number
  /** Shadow version (`shadowEpoch`) of the last image: another one restarts a still average. */
  shadowsSeen: number
  /** True when the current image accumulates: rendered with jitter, resolved by the pass. */
  active: boolean
  /** Scale the last ordinary image was drawn at (`ScaleControl.wanted`), which a convergence image keeps. */
  scale: number
  /** Rank of a MOVING image, whose lighting is drawn per pixel (`../lighting/direct/lightSamplingWgsl.ts`):
   *  bounded, different from one to the next, replayed with the image. Zero when still. */
  sampledRank: number
  /** In a capture's barrier (`../webgpu/tile/converge.ts`), the jitter phase its convergence image
   *  draws, counted from the replayed one, at the still image's scale; `null` in any other image. */
  stillPhase: number | null
}

/** What a convergence image replays of the last ordinary image: see `checkpoint`. */
export function createTaaCheckpoint() {
  return {
    read: 0,
    sample: 0,
    stochasticSample: 0,
    stillFrames: 0,
    hasHistory: false,
    sceneSeen: -1,
    quiet: false,
    sampledRank: 0,
    previousViewProjection: new Float64Array(16),
    previousEye: new Float64Array(3),
  }
}

export function createTaaFrameState(): TaaFrameState {
  return {
    sample: 0,
    stochasticSample: 0,
    phases: TAA_SAMPLES,
    jitter: new Float64Array(2),
    jitterGrid: new Float64Array(2),
    viewProjection: new Float64Array(16),
    cameraViewProjection: new Float64Array(16),
    previousViewProjection: new Float64Array(16),
    previousEye: new Float64Array(3),
    hasHistory: false,
    stillFrames: 0,
    stillDrawn: 0,
    sceneSeen: -1,
    shadowsSeen: 0,
    viewSeen: -1,
    active: false,
    scale: 1,
    sampledRank: 0,
    stillPhase: null,
  }
}

/** The image's stochastic phase, the one the lighting's noise turns with (the deferred view's
 *  `jitter.w`, `jitterWords.ts`): it advances on accumulated images alone, a capture's convergence replays it; none without the
 *  temporal accumulation. */
export const stochasticPhase = (taa: TaaFrameState | undefined) =>
  taa?.active ? taa.stochasticSample + (taa.stillPhase ?? 0) : 0

/** Slots of the resolve's stochastic pattern (`writeTaaView`): the accumulated image's own rank
 *  modulo them. The one other reading of `stochasticSample` beside `stochasticPhase`: without the
 *  convergence images' offset, the replayed image's own rank, as the resolve re-reads it. */
const STOCHASTIC_SLOTS = 8
export const stochasticSlot = (taa: TaaFrameState) => taa.stochasticSample % STOCHASTIC_SLOTS
