import type { BoundSampler } from '../../../sdk-core/src/world/animation/mixer.ts'
import {
  trackWidth,
  type Track,
  type TrackBinding,
} from '../../../sdk-core/src/world/animation/clip.ts'
import { sample } from '../../../sdk-core/src/world/animation/sample.ts'
import { AHEAD_HEADER, AHEAD_QUESTION, type AheadMessage } from './animationAhead.ts'
import { bindSampler } from './batchAnimation.ts'
import { loadMathBatch, mathBatchWasm } from './batchState.ts'

/**
 * Entry point of the animation worker (`animationAhead.ts`): it holds the clips the main thread
 * sends once, one sampler per action bound — the main thread's own WebAssembly sampler
 * (`bindSampler`), so its numbers are the main thread's bit for bit —, and answers each frame's
 * buffer in place: every question's sample written after it, a NaN time where it has no sampler,
 * the buffer then sent back, transferred. Messages that arrive before the module is loaded wait
 * for it, in order.
 *
 * A dedicated worker's scope is not typed by the repository's DOM library; the minimal shape
 * this file needs is declared here, as `pageWorker.ts` does.
 */
type AnimationWorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null
  postMessage(message: unknown, transfer: ArrayBuffer[]): void
}

const scope = globalThis as unknown as AnimationWorkerScope
/** The clips received, by id, with how many samplers play them. */
const clips = new Map<number, { tracks: Track[]; users: number }>()
/** The samplers bound, by id; `null` for one whose clip does not pack. */
const samplers = new Map<number, { sampler: BoundSampler; length: number } | null>()
/** Messages received before the module is loaded. */
const waiting: unknown[] = []
let loaded = false

/** `tracks` sampled the JavaScript way, into one sample's numbers from each track's offset. */
function fallbackOf(tracks: readonly Track[]) {
  const bindings: TrackBinding[] = tracks.map((tr) => ({
    owner: {},
    field: '',
    key: 0,
    value: new Float64Array(trackWidth(tr)),
  }))
  return (t: number, out: Float64Array, offsets: Uint32Array) => {
    for (let k = 0; k < tracks.length; k++) out.set(sample(tracks[k], t, bindings[k]), offsets[k])
  }
}

/** One frame's questions answered in their buffer, which goes back. */
function answer(buffer: ArrayBuffer) {
  const numbers = new Float64Array(buffer),
    end = numbers[1]
  for (let at = AHEAD_HEADER; at < end;) {
    const bound = samplers.get(numbers[at]),
      length = numbers[at + 2]
    if (bound && bound.length === length) {
      const out = bound.sampler.sample(numbers[at + 1]),
        from = bound.sampler.at,
        to = at + AHEAD_QUESTION
      for (let c = 0; c < length; c++) numbers[to + c] = out[from + c]
    } else numbers[at + 1] = NaN
    at += AHEAD_QUESTION + length
  }
  scope.postMessage(buffer, [buffer])
}

/** A frame's buffer, or what is bound and let go. */
function receive(message: unknown) {
  if (message instanceof ArrayBuffer) return answer(message)
  const said = message as AheadMessage
  if (said.op === 'clip') return void clips.set(said.clip, { tracks: said.tracks, users: 0 })
  const clip = clips.get(said.clip)
  if (said.op === 'bind') {
    const wasm = mathBatchWasm()
    if (clip) clip.users++
    const sampler = clip && wasm && bindSampler(wasm, clip.tracks, fallbackOf(clip.tracks))
    const length = clip ? clip.tracks.reduce((sum, tr) => sum + trackWidth(tr), 0) : 0
    return void samplers.set(said.id, sampler ? { sampler, length } : null)
  }
  samplers.get(said.id)?.sampler.release()
  samplers.delete(said.id)
  if (clip && --clip.users <= 0) clips.delete(said.clip)
}

scope.onmessage = (event) => {
  if (loaded) receive(event.data)
  else waiting.push(event.data)
}

void loadMathBatch().then(() => {
  loaded = true
  for (const message of waiting) receive(message)
  waiting.length = 0
})
