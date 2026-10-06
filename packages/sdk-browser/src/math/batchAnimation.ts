import { trackWidth, type Track } from '../../../sdk-core/src/world/animation/clip.ts'
import {
  lendActionSampler,
  type ActionSampler,
  type BoundSampler,
  type SampleInto,
} from '../../../sdk-core/src/world/animation/mixer.ts'
import type { SdkWasm } from '../page/decode/geometryPageWasm.ts'
import { reserveArena, type Arena } from '../page/decode/wasmArena.ts'
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
import { joue } from './batchLot.ts'
import { loadMathBatch, mathBatchWasm } from './batchState.ts'

/**
 * THE WEBASSEMBLY ANIMATION SAMPLER (`packages/page-codec-wasm/src/anim.rs`), lent to the mixer
 * (`lendActionSampler`): an action whose tracks all pack is sampled in one call — every key
 * search, line, spline and slerp of its clip at one time — into numbers its writes then read.
 * Its numbers are `sample`'s (`packages/sdk-core/src/world/animation/sample.ts`) bit for bit:
 * the same arithmetic in the same order, fdlibm's arc cosine and sine on both sides. The governor
 * picks the path by its timings (`joue`); the JavaScript one is the mixer's own `sample`, written
 * into the same numbers (`SampleInto`).
 *
 * A clip's tracks are packed once into the module's memory, shared by the actions that play them:
 * per track `TRACK_WORDS` words — where its times start, its key count, where its values start,
 * its width, its kind, where its sample starts — then its times and values. An action keeps its
 * keys, arcs and numbers beside them. A track packs when its times and values are single-precision
 * arrays, it has a key, its values hold a whole number of samples, and a rotation is four wide.
 *
 * While the loop steps by a fixed delta, an action's next sample is asked ahead of its frame
 * (`ahead`) of a worker running this same sampler (`animationAhead.ts`, `animationWorker.ts`): the
 * next `sample` at exactly that time reads it from the frame's buffer instead of computing it.
 */

/** Name under which the governor holds the medians. */
const ANIMATION_SAMPLE = 'animSampleTracks'
/** `anim.rs`'s layout: words a track, numbers of an arc, kind bits. */
const TRACK_WORDS = 6,
  ARC_VALUES = 4,
  QUATERNION = 1,
  STEP = 2,
  CUBIC = 4

/** A clip's tracks in the module: their description, times and values. */
type PackedClip = {
  tracks: readonly Track[]
  arena: Arena
  n: number
  dataLength: number
  outLength: number
  offsets: Uint32Array
}

/** The packed clips, by the tracks array they were packed from (checked track by track). */
const packed = new WeakMap<readonly Track[], PackedClip>()
/** Frees the module memory of what the engine no longer holds. */
const freed = new FinalizationRegistry<Arena>((arena) => arena.freed())

/** A track's width and kind, or `undefined` when it does not pack. */
function shapeOf(tr: Track) {
  const count = tr.times.length,
    cubic = tr.interpolation === 'cubic',
    quaternion = tr.kind === 'quaternion',
    width = trackWidth(tr)
  if (!(tr.times instanceof Float32Array) || !(tr.values instanceof Float32Array)) return undefined
  if (!(count >= 1) || !Number.isInteger(width) || width < 1 || (quaternion && width !== 4))
    return undefined
  const kind =
    (quaternion ? QUATERNION : 0) | (tr.interpolation === 'step' ? STEP : cubic ? CUBIC : 0)
  return { width, kind }
}

/** `tracks` packed into the module, or `undefined` when one of them does not pack. */
function pack(wasm: SdkWasm, tracks: readonly Track[]): PackedClip | undefined {
  const shapes = tracks.map(shapeOf)
  if (shapes.some((shape) => !shape)) return undefined
  let dataLength = 0,
    outLength = 0
  for (const tr of tracks) dataLength += tr.times.length + tr.values.length
  for (const shape of shapes) outLength += shape!.width
  const n = tracks.length,
    arena = reserveArena(wasm, [
      { type: 'u32', length: Math.max(1, n * TRACK_WORDS) },
      { type: 'f32', length: Math.max(1, dataLength) },
    ])
  if (!arena) return undefined
  const [described, data] = arena.blocs().map((bloc) => bloc.view)
  const offsets = new Uint32Array(n)
  let at = 0,
    out = 0
  tracks.forEach((tr, k) => {
    const { width, kind } = shapes[k]!
    data.set(tr.times, at)
    data.set(tr.values, at + tr.times.length)
    described.set([at, tr.times.length, at + tr.times.length, width, kind, out], k * TRACK_WORDS)
    offsets[k] = out
    at += tr.times.length + tr.values.length
    out += width
  })
  const clip = { tracks: tracks.slice(), arena, n, dataLength, outLength, offsets }
  freed.register(clip, arena)
  return clip
}

/** The packed clip of `tracks`, packed on first use and again when a track changed. */
function packedOf(wasm: SdkWasm, tracks: readonly Track[]) {
  const known = packed.get(tracks)
  if (known?.tracks.length === tracks.length && known.tracks.every((tr, k) => tr === tracks[k]))
    return known
  const made = pack(wasm, tracks)
  if (made) packed.set(tracks, made)
  return made
}

/** One action's sampler over `clip`: its keys, arcs and numbers in the module. */
function boundSampler(
  wasm: SdkWasm,
  clip: PackedClip,
  fallback: SampleInto,
): BoundSampler | undefined {
  const { n, dataLength, outLength, offsets } = clip
  const state = reserveArena(wasm, [
    { type: 'u32', length: Math.max(1, n) },
    { type: 'f64', length: Math.max(1, n * ARC_VALUES) },
    { type: 'f64', length: Math.max(1, outLength) },
  ])
  if (!state) return undefined
  state.blocs()[1].view.fill(-1)
  const numbers = new Float64Array(Math.max(1, outLength))
  const handle = aheadHandle(clip, clip.tracks, outLength)
  let time = 0
  const [tracks, data] = clip.arena.blocs().map((bloc) => bloc.offset),
    [keys, arcs, out] = state.blocs().map((bloc) => bloc.offset)
  const wasmRun = () =>
      wasm.anim_sample_tracks(tracks, n, data, dataLength, keys, arcs, out, outLength, time),
    jsRun = () => fallback(time, state.blocs()[2].view as Float64Array, offsets)
  const bound = {
    offsets,
    at: 0,
    sample(t: number) {
      const taken = takeAhead(handle, t)
      if (taken) return ((bound.at = handle.at), taken)
      bound.at = 0
      time = t
      joue(ANIMATION_SAMPLE, n, wasmRun, jsRun)
      // Copied out in one move: the writes then read an ordinary array, not the module's memory,
      // whose every read the engine checks against its growth.
      return (numbers.set(state.blocs()[2].view as Float64Array), numbers)
    },
    ahead(t: number) {
      askAhead(handle, t)
    },
    release() {
      freed.unregister(bound)
      releaseAhead(handle)
      state.freed()
    },
  }
  freed.register(bound, state, bound)
  // The clip's room lives as long as one of its actions does.
  ;(bound as { clip?: PackedClip }).clip = clip
  return bound
}

/** An action's sampler on `tracks` in the module, `fallback` its JavaScript path: what the mixer
 *  is lent, and what the worker samples with; `undefined` when a track does not pack. */
export function bindSampler(wasm: SdkWasm, tracks: readonly Track[], fallback: SampleInto) {
  const clip = packedOf(wasm, tracks)
  return clip && boundSampler(wasm, clip, fallback)
}

/** The animation worker, started on the first sample asked ahead: a page's `Worker` is the port
 *  the channel speaks to. */
const startAnimationWorker = () =>
  startModuleWorker(besideModule('animationWorker', import.meta.url)) as unknown as AheadPort

let lent: Promise<ActionSampler | null> | null = null

/** Lends the mixer the WebAssembly sampler once the module is there, and gives it; nothing
 *  without the module (`null`). Where a page can start a worker, the samples of a fixed step are
 *  taken ahead on one (`animationAhead.ts`). */
export function lendAnimationSampler() {
  lent ??= loadMathBatch().then(() => {
    const wasm = mathBatchWasm()
    if (!wasm || typeof wasm.anim_sample_tracks !== 'function') return null
    const sampler: ActionSampler = {
      bind: (tracks, fallback) => bindSampler(wasm, tracks, fallback),
      frame: aheadFrame,
    }
    lendActionSampler(sampler)
    if (typeof Worker !== 'undefined') sampleAhead(startAnimationWorker)
    return sampler
  })
  return lent
}
