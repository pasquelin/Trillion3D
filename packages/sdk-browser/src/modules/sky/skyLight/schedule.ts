import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { CUBE_FACES, TIME_SLICE_COUNT } from './layout.ts'

/**
 * WHAT THE CAPTURE DOES IN A FRAME, and the state it keeps from one frame to the next. Pure: it
 * decides, the capture (`capture.ts`) encodes.
 *
 * Not sliced, or until the cube has once been complete — the first frame, and the next while the
 * light is sliced — every step runs in one frame: the sky and the clouds of the six faces, the mips,
 * the filter of every mip, the harmonics, read from the filtered cube, which is the ready one.
 * Sliced, a frame does one step and the cube it fills is the other of the two filtered cubes; when
 * the twelve steps are done the two are swapped:
 * - 0, the sky of `facesPerFrame` faces a frame, the state staying until the six are drawn;
 * - 1, the clouds of the faces, the same way;
 * - 2, the captured cube's mips;
 * - 3, 4, 5, the filter of the top mip, two faces each;
 * - 6, 7, 8, the filter of mips 1, 2 and 3;
 * - 9, mips 4 and 5 (or 4 alone when it is the last);
 * - 10, mips 6 to the last;
 * - 11, the harmonics.
 * A mip a cube does not have is a step that does nothing. With the defaults a cube takes 16 frames.
 */

/** What a frame does: the whole capture, or one step. */
export type CaptureStep =
  | { readonly kind: 'whole' }
  | { readonly kind: 'sky' | 'clouds'; readonly faceFirst: number; readonly faceEnd: number }
  | { readonly kind: 'mips' }
  | {
      readonly kind: 'filter'
      readonly mipFirst: number
      readonly mipLast: number
      readonly faceFirst: number
      readonly faceCount: number
    }
  | { readonly kind: 'harmonics' }
  | { readonly kind: 'nothing' }

/** The capture's memory between frames. */
export interface CaptureState {
  /** 0 before the first frame, 1 on it, 2 after; not sliced, always 0. */
  first: 0 | 1 | 2
  /** Whether the cube has been complete once. */
  complete: boolean
  /** The step of the sliced capture, -1 until the whole one has run. */
  step: number
  /** The faces already drawn of the sky or the clouds step. */
  subStep: number
  /** Which of the two filtered cubes is ready, read by the lighting. */
  ready: 0 | 1
}

export const newCaptureState = (): CaptureState => ({
  first: 0,
  complete: false,
  step: -1,
  subStep: 0,
  ready: 0,
})

/** The settings the schedule reads. */
export interface ScheduleOptions {
  timeSlice: boolean
  facesPerFrame: number
  /** The cube's mips. */
  mips: number
}

/** A step that filters `first` to `last` of a cube whose last mip is `lastMip`, nothing when the
 *  cube does not have the first. */
const filterMips = (first: number, last: number, lastMip: number): CaptureStep =>
  lastMip >= first
    ? {
        kind: 'filter',
        mipFirst: first,
        mipLast: Math.min(last, lastMip),
        faceFirst: 0,
        faceCount: CUBE_FACES,
      }
    : { kind: 'nothing' }

/** One half of the top mip's filter: `faceFirst` and the next. */
const topMip = (faceFirst: number): CaptureStep => ({
  kind: 'filter',
  mipFirst: 0,
  mipLast: 0,
  faceFirst,
  faceCount: 2,
})

/**
 * The state after one more frame, mutated in place, and what that frame does. Called once a frame.
 */
export function advanceCapture(state: CaptureState, options: ScheduleOptions): CaptureStep {
  const { timeSlice, facesPerFrame, mips } = options
  if (timeSlice) {
    if (state.first === 0) {
      state.first = 1
      state.complete = false
    } else if (state.first === 1) state.first = 2
  } else state.first = 0
  if (!timeSlice || state.first < 2 || !state.complete) {
    state.complete = true
    state.ready = 0
    state.step = -1
    state.subStep = 0
    return { kind: 'whole' }
  }
  const perFrame = clamp(facesPerFrame, 1, CUBE_FACES)
  const lastEnd = clamp(state.subStep + perFrame, 0, CUBE_FACES)
  let done = true
  if (state.step === 0 || state.step === 1) {
    done = lastEnd >= CUBE_FACES
    state.subStep = done ? 0 : lastEnd
  }
  if (done && ++state.step >= TIME_SLICE_COUNT) {
    state.ready = state.ready === 0 ? 1 : 0
    state.step = 0
    state.subStep = 0
  }
  const faceFirst = clamp(state.subStep, 0, CUBE_FACES - 1)
  const faceEnd = clamp(state.subStep + perFrame, 0, CUBE_FACES)
  const lastMip = mips - 1
  switch (state.step) {
    case 0:
      return { kind: 'sky', faceFirst, faceEnd }
    case 1:
      return { kind: 'clouds', faceFirst, faceEnd }
    case 2:
      return { kind: 'mips' }
    case 3:
      return topMip(0)
    case 4:
      return topMip(2)
    case 5:
      return topMip(4)
    case 6:
      return filterMips(1, 1, lastMip)
    case 7:
      return filterMips(2, 2, lastMip)
    case 8:
      return filterMips(3, 3, lastMip)
    case 9:
      return filterMips(4, 5, lastMip)
    case 10:
      return filterMips(6, lastMip, lastMip)
    default:
      return { kind: 'harmonics' }
  }
}

/** The filtered cube the capture writes this frame: the one that is not ready. */
export const workIndex = (state: CaptureState) => (state.ready === 0 ? 1 : 0)
