import { trackWidth, type Track } from '../../../sdk-core/src/world/animation/clip.ts'
import { sampleInto } from '../../../sdk-core/src/world/animation/sample.ts'
import { AHEAD_HEADER, AHEAD_QUESTION, type AheadMessage } from './animationAhead.ts'
import { trackOffsets } from './animationSampler.ts'
import { type WorkerScope } from '../host/workerScope.ts'

/**
 * Entry point of the animation worker (`animationAhead.ts`): it holds the clips the main thread
 * sends once, one sampler per action bound — the engine's own `sampleInto`, so its numbers are
 * the main thread's bit for bit —, and answers each frame's buffer in place: every question's
 * sample written after it, a NaN time where it has no sampler, the buffer then sent back,
 * transferred.
 */
const scope = globalThis as unknown as WorkerScope
/** The clips received, by id, with how many samplers play them. */
const clips = new Map<number, { tracks: Track[]; users: number }>()
/** The samplers bound, by id; `null` for a clip not received. */
const samplers = new Map<number, ReturnType<typeof samplerOf> | null>()

/** `tracks` sampled at a time into one sample's numbers, each track from its offset. */
function samplerOf(tracks: readonly Track[]) {
  const slots = tracks.map((tr) => ({
      binding: { owner: {}, field: '', key: 0, value: new Float64Array(trackWidth(tr)) },
    })),
    { offsets, length } = trackOffsets(tracks),
    numbers = new Float64Array(length)
  return {
    length,
    sample(t: number) {
      sampleInto(tracks, slots, t, numbers, offsets)
      return numbers
    },
  }
}

/** One frame's questions answered in their buffer, which goes back. */
function answer(buffer: ArrayBuffer) {
  const numbers = new Float64Array(buffer),
    end = numbers[1]
  for (let at = AHEAD_HEADER; at < end;) {
    const bound = samplers.get(numbers[at]),
      length = numbers[at + 2]
    if (bound && bound.length === length)
      numbers.set(bound.sample(numbers[at + 1]), at + AHEAD_QUESTION)
    else numbers[at + 1] = NaN
    at += AHEAD_QUESTION + length
  }
  scope.postMessage(buffer, [buffer])
}

/** A frame's buffer, or what is bound and let go. */
scope.onmessage = (event) => {
  const message = event.data as ArrayBuffer | AheadMessage
  if (message instanceof ArrayBuffer) return answer(message)
  if (message.op === 'clip')
    return void clips.set(message.clip, { tracks: message.tracks, users: 0 })
  const clip = clips.get(message.clip)
  if (message.op === 'bind') {
    if (clip) clip.users++
    return void samplers.set(message.id, clip ? samplerOf(clip.tracks) : null)
  }
  samplers.delete(message.id)
  if (clip && --clip.users <= 0) clips.delete(message.clip)
}
