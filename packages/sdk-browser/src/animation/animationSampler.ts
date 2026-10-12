import { trackWidth, type Track } from '../../../sdk-core/src/world/animation/clip.ts'
import {
  lendActionSampler,
  type ActionSampler,
  type BoundSampler,
  type SampleInto,
} from '../../../sdk-core/src/world/animation/mixer.ts'
import { besideModule, startModuleWorker } from '../host/besideModule.ts'
import {
  aheadFrame,
  aheadHandle,
  askAhead,
  releaseAhead,
  sampleAhead,
  takeAhead,
  type AheadPort,
} from './animationAhead.ts'

/**
 * THE ANIMATION SAMPLES TAKEN AHEAD, lent to the mixer (`lendActionSampler`). There is one
 * sampler, `sample` (`packages/sdk-core/src/world/animation/sample.ts`), on the main thread and on
 * the worker alike: no path is chosen by a timing, so a pose is the same bits at every play.
 *
 * While the loop steps by a fixed delta, an action's next sample is asked ahead of its frame
 * (`ahead`) of a worker running that same sampler (`animationAhead.ts`, `animationWorker.ts`): the
 * next `sample` at exactly that time reads it from the frame's buffer instead of computing it,
 * the mixer's own `fallback` computing it when the buffer does not hold it.
 */

/** Where each of `tracks`' samples starts in a whole action's numbers, and how many there are. */
export function trackOffsets(tracks: readonly Track[]) {
  const offsets = new Uint32Array(tracks.length)
  let length = 0
  for (let k = 0; k < tracks.length; k++) {
    offsets[k] = length
    length += trackWidth(tracks[k])
  }
  return { offsets, length }
}

/** The clip a `tracks` array stands for, checked track by track: what the worker is sent once. */
type Clip = { tracks: readonly Track[] }
const clips = new WeakMap<readonly Track[], Clip>()

/** The clip of `tracks`, made on first use and again when a track changed. */
function clipOf(tracks: readonly Track[]) {
  const known = clips.get(tracks)
  if (known?.tracks.length === tracks.length && known.tracks.every((tr, k) => tr === tracks[k]))
    return known
  const made = { tracks: tracks.slice() }
  clips.set(tracks, made)
  return made
}

/** One action's sampler over `tracks`: the samples read from the worker's buffer, else `fallback`
 *  computed here. */
function boundSampler(tracks: readonly Track[], fallback: SampleInto): BoundSampler | undefined {
  const { offsets, length } = trackOffsets(tracks)
  if (length === 0) return undefined
  const numbers = new Float64Array(length),
    handle = aheadHandle(clipOf(tracks), tracks, length)
  const bound = {
    offsets,
    at: 0,
    sample(t: number) {
      const taken = takeAhead(handle, t)
      if (taken) return ((bound.at = handle.at), taken)
      bound.at = 0
      fallback(t, numbers, offsets)
      return numbers
    },
    ahead(t: number) {
      askAhead(handle, t)
    },
    release() {
      releaseAhead(handle)
    },
  }
  return bound
}

/** The animation worker, started on the first sample asked ahead: a page's `Worker` is the port
 *  the channel speaks to. */
const startAnimationWorker = () =>
  startModuleWorker(besideModule('animationWorker', import.meta.url)) as unknown as AheadPort

/** The sampler lent to the mixer. */
export const animationSampler: ActionSampler = {
  bind: (tracks, fallback) => boundSampler(tracks, fallback),
  frame: aheadFrame,
}

/** Lends the mixer the sampler that takes the samples of a fixed step ahead on a worker
 *  (`animationAhead.ts`), where a page can start one; nothing elsewhere, the mixer then samples
 *  track by track. */
export function lendAnimationSampler() {
  if (typeof Worker === 'undefined') return
  lendActionSampler(animationSampler)
  sampleAhead(startAnimationWorker)
}
