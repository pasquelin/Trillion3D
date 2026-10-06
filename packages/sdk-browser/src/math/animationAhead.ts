import type { Track } from '../../../sdk-core/src/world/animation/clip.ts'

/**
 * THE ANIMATION SAMPLES TAKEN AHEAD ON A WORKER (`animationWorker.ts`). While the world's loop
 * steps by a fixed delta, an action's clip time in the next frame is known at the end of this one
 * (`advanceMixers`): each action asks for it (`askAhead`), the frame's questions leave in one
 * buffer the worker fills with its WebAssembly sampler while the main thread draws, and the next
 * frame's sample of that action at that time is read from it (`takeAhead`). A pose is a function of
 * the clip's tracks and the time alone, so a sample the buffer holds for exactly the time asked is
 * the one the main thread would compute, bit for bit; any other time — a delta that changed, a
 * play, stop, seek or speed changed in between — or a buffer not back yet is sampled on the main
 * thread as before (`batchAnimation.ts`), in that same frame: never a stale pose, never a frame late.
 *
 * Two buffers go back and forth, transferred, never copied: one read by the frame the main thread
 * is computing, one filled by the worker for the next. A buffer holds `[seq, end]`, then per
 * question the sampler's id, the clip time (the worker writes NaN there when it cannot answer) and
 * how many numbers follow, then those numbers. A buffer grows when the frame's questions outgrow
 * it, and only then: a frame allocates no buffer.
 */

/** The worker as the main thread speaks to it: a DOM `Worker`, or a test's thread behind one. */
export interface AheadPort {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void
  onmessage: ((event: { data: unknown }) => void) | null
}

/** What the worker receives besides the frames' buffers. */
export type AheadMessage =
  | { op: 'clip'; clip: number; tracks: Track[] }
  | { op: 'bind'; id: number; clip: number }
  | { op: 'release'; id: number; clip: number }

/** Numbers ahead of a buffer's questions: its sequence number and where its questions end. */
export const AHEAD_HEADER = 2
/** Numbers ahead of each question's sample: the sampler's id, the clip time, the sample's length. */
export const AHEAD_QUESTION = 3
/** A buffer's first length, in numbers: a rig of a hundred tracks a few times over. */
const FIRST_LENGTH = 4096

/** One bound sampler's place on the channel: the clip it samples, its id on the worker, where its
 *  last question stands. */
type AheadHandle = {
  /** The clip's packed tracks, shared by the actions playing it: one `clip` message per port. */
  readonly clip: object
  readonly tracks: readonly Track[]
  /** Numbers in one sample. */ readonly length: number
  /** The port it is bound on, `null` until its first question. */ port: AheadPort | null
  id: number
  /** The buffer its last question went in, and where that question's sample starts. */
  seq: number
  at: number
}

/** The port's starter, the port once started, and whether questions are asked. */
let starter: (() => AheadPort | null) | null = null
let port: AheadPort | null = null
let on = false
/** Each clip's id on the port, and how many of its samplers are bound there. */
let clipIds = new WeakMap<object, number>()
const clipUsers = new Map<number, number>()
let nextId = 1
/** The buffer read this frame, the free ones, the one the frame's questions go in, its end. */
let ready: Float64Array<ArrayBuffer> | null = null
let request: Float64Array<ArrayBuffer> | null = null
let cursor = AHEAD_HEADER
const free: Float64Array<ArrayBuffer>[] = []
/** Buffers made for the port: two go back and forth. */
let made = 0
/** The sequence number of the last buffer posted. */
let seq = 0

/** Lets the worker know a sampler the engine dropped without releasing it. */
const dropped = new FinalizationRegistry<{ port: AheadPort; id: number; clip: object }>((held) => {
  if (held.port === port) forget(held.id, held.clip)
})

/**
 * Takes the mixers' samples ahead on the port `start` gives on the first question (`null`: none
 * asked, every sample on the main thread). The port started stays for the same `start`, with what
 * is bound on it; another `start` starts over on a new one.
 */
export function sampleAhead(start: (() => AheadPort | null) | null) {
  if (ready) free.push(ready)
  if (request) free.push(request)
  ready = request = null
  on = start !== null
  if (!start || start === starter) return
  if (port) port.onmessage = null
  starter = start
  port = null
  clipIds = new WeakMap()
  clipUsers.clear()
  free.length = made = 0
}

/** A sampler's place on the channel, bound on its first question. */
export function aheadHandle(clip: object, tracks: readonly Track[], length: number): AheadHandle {
  return { clip, tracks, length, port: null, id: 0, seq: 0, at: 0 }
}

/** A buffer come back from the worker: the next frame's when it answers the last one posted. */
function arrive(event: { data: unknown }) {
  const buffer = new Float64Array(event.data as ArrayBuffer)
  if (buffer[0] !== seq || !on) return void free.push(buffer)
  if (ready) free.push(ready)
  ready = buffer
}

/** Binds `handle` on the port: its clip's tracks once a port, then the sampler. */
function bind(handle: AheadHandle, target: AheadPort) {
  let clip = clipIds.get(handle.clip)
  if (clip === undefined) {
    clipIds.set(handle.clip, (clip = nextId++))
    // The tracks are copied once, by the structured clone, as plain records: the clip stays the
    // engine's, whatever class carries its tracks.
    const tracks = handle.tracks.map(({ name, kind, times, values, interpolation }) => ({
      name,
      kind,
      times,
      values,
      interpolation,
    }))
    target.postMessage({ op: 'clip', clip, tracks } satisfies AheadMessage, [])
  }
  clipUsers.set(clip, (clipUsers.get(clip) ?? 0) + 1)
  handle.port = target
  handle.id = nextId++
  handle.seq = 0
  target.postMessage({ op: 'bind', id: handle.id, clip } satisfies AheadMessage, [])
  dropped.register(handle, { port: target, id: handle.id, clip: handle.clip }, handle)
}

/** Tells the worker its sampler `id` is gone, and `clip`'s tracks with its last sampler. */
function forget(id: number, clip: object) {
  const known = clipIds.get(clip)
  if (known === undefined) return
  port?.postMessage({ op: 'release', id, clip: known } satisfies AheadMessage, [])
  const users = (clipUsers.get(known) ?? 1) - 1
  if (users > 0) return void clipUsers.set(known, users)
  clipUsers.delete(known)
  clipIds.delete(clip)
}

/** Lets `handle`'s sampler go on the worker. */
export function releaseAhead(handle: AheadHandle) {
  if (!handle.port || handle.port !== port) return
  dropped.unregister(handle)
  forget(handle.id, handle.clip)
  handle.port = null
}

/** Asks for `handle`'s sample at clip time `t` in the next frame; nothing without a free buffer. */
export function askAhead(handle: AheadHandle, t: number) {
  if (!on || handle.length === 0) return
  if (!port) {
    port = starter!()
    if (!port) return void (on = false)
    port.onmessage = arrive
  }
  if (handle.port !== port) bind(handle, port)
  if (!request) {
    request = free.pop() ?? (made < 2 ? (made++, new Float64Array(FIRST_LENGTH)) : null)
    if (!request) return
    cursor = AHEAD_HEADER
  }
  const end = cursor + AHEAD_QUESTION + handle.length
  if (end > request.length) {
    const grown = new Float64Array(Math.max(2 * request.length, end))
    grown.set(request.subarray(0, cursor))
    request = grown
  }
  request[cursor] = handle.id
  request[cursor + 1] = t
  request[cursor + 2] = handle.length
  handle.seq = seq + 1
  handle.at = cursor + AHEAD_QUESTION
  cursor = end
}

/** The buffer holding `handle`'s sample at clip time `t`, from `handle.at`; `null` when none
 *  does — then the caller samples it itself. */
export function takeAhead(handle: AheadHandle, t: number) {
  const buffer = ready,
    at = handle.at
  if (
    buffer &&
    buffer[0] === handle.seq &&
    handle.port === port &&
    buffer[at - 3] === handle.id &&
    Object.is(buffer[at - 2], t)
  )
    return buffer
  return null
}

/** The frame's mixers all sampled: the buffer read goes free, the questions asked leave. */
export function aheadFrame() {
  if (ready) free.push(ready)
  ready = null
  if (!request) return
  if (cursor > AHEAD_HEADER && port) {
    request[0] = ++seq
    request[1] = cursor
    port.postMessage(request.buffer, [request.buffer])
  } else free.push(request)
  request = null
}
