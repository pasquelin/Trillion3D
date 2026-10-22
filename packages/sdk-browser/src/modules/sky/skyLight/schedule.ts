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

/** What each step of a sliced capture does, from its faces and the cube's last mip; the step after
 *  the last of these sums the harmonics. */
const SLICE_STEPS: readonly ((
  faceFirst: number,
  faceEnd: number,
  lastMip: number,
) => CaptureStep)[] = [
  (faceFirst, faceEnd) => ({ kind: 'sky', faceFirst, faceEnd }),
  (faceFirst, faceEnd) => ({ kind: 'clouds', faceFirst, faceEnd }),
  () => ({ kind: 'mips' }),
  () => topMip(0),
  () => topMip(2),
  () => topMip(4),
  (_a, _b, lastMip) => filterMips(1, 1, lastMip),
  (_a, _b, lastMip) => filterMips(2, 2, lastMip),
  (_a, _b, lastMip) => filterMips(3, 3, lastMip),
  (_a, _b, lastMip) => filterMips(4, 5, lastMip),
  (_a, _b, lastMip) => filterMips(6, lastMip, lastMip),
]

/** The slicing's first two frames are whole captures: `first` counts them, and a sliced capture
 *  starts incomplete. */
function startSlicing(state: CaptureState, timeSlice: boolean) {
  if (!timeSlice) state.first = 0
  else if (state.first === 0) {
    state.first = 1
    state.complete = false
  } else if (state.first === 1) state.first = 2
}

/** The step after this one: the faces of the sky and clouds steps take `perFrame` at a time, and the
 *  steps after the last start the other filtered cube. */
function moveStep(state: CaptureState, perFrame: number) {
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
}

/**
 * The state after one more frame, mutated in place, and what that frame does. Called once a frame.
 */
export function advanceCapture(state: CaptureState, options: ScheduleOptions): CaptureStep {
  const { timeSlice, facesPerFrame, mips } = options
  startSlicing(state, timeSlice)
  if (!timeSlice || state.first < 2 || !state.complete) {
    state.complete = true
    state.ready = 0
    state.step = -1
    state.subStep = 0
    return { kind: 'whole' }
  }
  const perFrame = clamp(facesPerFrame, 1, CUBE_FACES)
  moveStep(state, perFrame)
  const faceFirst = clamp(state.subStep, 0, CUBE_FACES - 1)
  const faceEnd = clamp(state.subStep + perFrame, 0, CUBE_FACES)
  return SLICE_STEPS[state.step]?.(faceFirst, faceEnd, mips - 1) ?? { kind: 'harmonics' }
}

/** The filtered cube the capture writes this frame: the one that is not ready. */
export const workIndex = (state: CaptureState) => (state.ready === 0 ? 1 : 0)
