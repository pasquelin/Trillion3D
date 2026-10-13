import { tileId, tileKeyOf } from '../../packages/sdk-browser/src/webgpu/tile/ids.ts'
import type { TilePolicy } from './tilePolicies.ts'
import type { TileTrace } from './trace.ts'

/** The replay's knobs: the pool's places, the feedback's cap (`FEEDBACK_HITS`), the readback's
 *  lag, the tiles a pass uploads, and the window a refetch is counted in. */
type TileReplayOptions = {
  places: number
  cap?: number
  lag?: number
  uploads?: number
  refetchWindow?: number
}

/** What a policy did over a trace (M1): tiles placed again within the refetch window of their
 *  eviction, per thousand frames; the pixel-weighted level deficit, Σ weight × (served − wanted)
 *  over the whole flight; placements refused; the frames each cut took to converge; the most tiles
 *  placed in one frame (M3's burst). */
export type TileReplay = {
  policy: string
  places: number
  refetchPerKiloFrame: number
  deficit: number
  refusals: number
  converge: number[]
  burst: number
}

/**
 * Replays `trace` through `policy` over a pool of `places` (M1 of the residency design): each frame
 * draws first — every sampled tile read at the finest resident level, the tail under the streamed
 * ones, its deficit counted and its place handed to the policy as the GPU stamps it —; the
 * feedback of the frame `lag` before is read back cut at `cap`, touches what the policy hears and
 * asks the missing tiles, heaviest first; a pass uploads `uploads` of them, each taking a free place
 * or the policy's victim. Uploads land at once: the policies differ in WHICH tile leaves, never in
 * the time a tile takes.
 */
export function replayTiles(
  trace: TileTrace,
  policy: TilePolicy,
  options: TileReplayOptions,
): TileReplay {
  const { places, cap = 16384, lag = 2, uploads = 64, refetchWindow = 64 } = options
  const owner = new Float64Array(places).fill(-1),
    resident = new Map<number, number>(),
    evictedAt = new Map<number, number>()
  const free = Array.from({ length: places }, (_, p) => places - 1 - p)
  /** The finest resident level reading tile `id`, and its place; the tail's, -1. */
  const served = (id: number) => {
    const key = tileKeyOf(id),
      tail = trace.tails[key.slot]
    for (let level = key.level; level < tail; level++) {
      const shift = level - key.level
      const at = resident.get(
        tileId({ slot: key.slot, level, tx: key.tx >> shift, ty: key.ty >> shift }),
      )
      if (at !== undefined) return { level, place: at }
    }
    return { level: tail, place: -1 }
  }
  const deficits: number[] = []
  let refetches = 0,
    refusals = 0,
    burst = 0
  for (let f = 0; f < trace.frames.length; f++) {
    const frame = trace.frames[f]
    // The image: what each pixel reads, and the places the GPU stamps.
    let deficit = 0
    const read = new Set<number>()
    for (let i = 0; i < frame.tiles.length; i++) {
      const id = frame.tiles[i],
        at = served(id)
      deficit += frame.weights[i] * (at.level - tileKeyOf(id).level)
      if (at.place >= 0) read.add(at.place)
    }
    deficits.push(deficit)
    policy.drew(f, read)
    // The feedback of `lag` frames before, cut at the cap: touched, then asked.
    const heard = f - lag >= 0 ? trace.frames[f - lag] : undefined
    const asked: { id: number; weight: number }[] = []
    const listed = heard ? Math.min(heard.tiles.length, cap) : 0
    for (let i = 0; i < listed; i++) {
      const id = heard!.tiles[i],
        own = resident.get(id)
      if (own !== undefined) {
        policy.touched(f, own, true)
        continue
      }
      const at = served(id)
      if (at.place >= 0) policy.touched(f, at.place, false)
      asked.push({ id, weight: heard!.weights[i] })
    }
    asked.sort((a, b) => b.weight - a.weight)
    let placed = 0
    for (const { id } of asked.slice(0, uploads)) {
      let place = free.pop()
      if (place === undefined) {
        place = policy.victim(f)
        if (place === undefined) {
          refusals++
          continue
        }
        resident.delete(owner[place])
        evictedAt.set(owner[place], f)
        policy.freed(place)
      }
      const left = evictedAt.get(id)
      if (left !== undefined && f - left <= refetchWindow) refetches++
      owner[place] = id
      resident.set(id, place)
      policy.placed(place, tileKeyOf(id).level, f)
      placed++
    }
    burst = Math.max(burst, placed)
    policy.ended(f)
  }
  return {
    policy: policy.name,
    places,
    refetchPerKiloFrame: (1000 * refetches) / Math.max(1, trace.frames.length),
    deficit: deficits.reduce((sum, d) => sum + d, 0),
    refusals,
    converge: convergence(trace, deficits),
    burst,
  }
}

/** Frames each cut takes until its frame's deficit is back under the mean of the thirty frames
 *  before it (or under the cut frame's own tenth, the first frames having no before): the flight's
 *  end when it never is. */
function convergence(trace: TileTrace, deficits: readonly number[]) {
  const frames: number[] = []
  trace.frames.forEach((frame, cut) => {
    if (!frame.cut) return
    const before = deficits.slice(Math.max(0, cut - 30), cut)
    const target = before.length
      ? before.reduce((sum, d) => sum + d, 0) / before.length
      : deficits[cut] / 10
    let at = cut
    while (at < deficits.length && deficits[at] > target) at++
    frames.push(at - cut)
  })
  return frames
}

/** The most distinct tiles one frame of `trace` asks: the working set the pool sizes are read off. */
export const peakWorkingSet = (trace: TileTrace) =>
  trace.frames.reduce((peak, frame) => Math.max(peak, frame.tiles.length), 0)
