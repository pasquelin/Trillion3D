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
  /** In a capture's barrier (`../webgpu/tile/converge.ts`), the jitter phase its convergence image
   *  draws, counted from the replayed one, at the still image's scale; `null` in any other image. */
  stillPhase: number | null
}

/** The fields a convergence image replays of the last ordinary image (`createTaaCheckpoint`): its
 *  values, then its arrays, copied in place. */
const REPLAYED = ['sample', 'stochasticSample', 'stillFrames', 'hasHistory', 'sceneSeen'] as const
const REPLAYED_ARRAYS = ['previousViewProjection', 'previousEye'] as const

const take = <K extends keyof TaaFrameState>(to: TaaFrameState, from: TaaFrameState, key: K) => {
  to[key] = from[key]
}
const copyReplayed = (to: TaaFrameState, from: TaaFrameState) => {
  for (const key of REPLAYED) take(to, from, key)
  for (const key of REPLAYED_ARRAYS) to[key].set(from[key])
}

/** Where the last ordinary image of `frame` started, which a convergence image (re-rendering the
 *  pose for arrived tiles) comes back to: `save` keeps it with that image's stillness, `restore`
 *  puts it back and returns that stillness. */
export function createTaaCheckpoint(frame: TaaFrameState) {
  const saved = createTaaFrameState()
  let quiet = false
  return {
    save(stillness: boolean) {
      copyReplayed(saved, frame)
      quiet = stillness
    },
    restore() {
      copyReplayed(frame, saved)
      return quiet
    },
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
