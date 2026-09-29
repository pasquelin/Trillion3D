import { TAA_SAMPLES } from './jitter.ts';

/** What the temporal pass keeps from one image to the next on the CPU side. */
export interface TaaFrameState {
  /** Jitter rank of the next accumulated image; only advances on those, over `phases`. */
  sample: number;
  /** Jitter phases of the frame's render-to-display ratio (`upscalePhases`): eight at native size. */
  phases: number;
  /** This image's jitter, in the pixels it is drawn in. */
  jitter: Float64Array;
  /** Render view-projection of this image, jitter included: what the raster, shading, blend and
   *  the partition read, decided once at image entry. */
  viewProjection: Float64Array;
  /** View-projection WITHOUT jitter of the last accumulated image: what the history describes. */
  previousViewProjection: Float64Array;
  hasHistory: boolean;
  /** Quiet images accumulated in a row; see `taaStillFrames`. Zero as soon as something moves. */
  stillFrames: number;
  /** Scene revision of the last accumulated image: another one causes poses to be compared. */
  sceneSeen: number;
  /** True when the current image accumulates: rendered with jitter, resolved by the pass. */
  active: boolean;
  /** Scale the last ordinary image was drawn at (`imageScale`), which a convergence image keeps. */
  scale: number;
  /** Rank of a MOVING image, whose lighting is drawn per pixel (`../lighting/direct/lightSamplingWgsl.ts`):
   *  bounded, different from one to the next, replayed with the image. Zero when still. */
  sampledRank: number;
  /** In a capture's barrier (`../webgpu/tile/converge.ts`), the jitter phase its convergence image
   *  draws, counted from the replayed one, at the still image's scale; `null` in any other image. */
  stillPhase: number | null;
}

/** What a convergence image replays of the last ordinary image: see `checkpoint`. */
export function createTaaCheckpoint() {
  return {
    read: 0,
    sample: 0,
    stillFrames: 0,
    hasHistory: false,
    sceneSeen: -1,
    quiet: false,
    sampledRank: 0,
    previousViewProjection: new Float64Array(16),
  };
}

export function createTaaFrameState(): TaaFrameState {
  return {
    sample: 0,
    phases: TAA_SAMPLES,
    jitter: new Float64Array(2),
    viewProjection: new Float64Array(16),
    previousViewProjection: new Float64Array(16),
    hasHistory: false,
    stillFrames: 0,
    sceneSeen: -1,
    active: false,
    scale: 1,
    sampledRank: 0,
    stillPhase: null,
  };
}
