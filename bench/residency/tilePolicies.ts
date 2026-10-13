import { ageStep, poolRank } from '../../packages/sdk-browser/src/gpu/pool/rank.fixture.ts'
import { EVICT_IN_USE, POOL_RANKS } from '../../packages/sdk-browser/src/gpu/pool/rank.ts'

/**
 * THE EVICTION POLICIES the replay compares (#1527, M1): what each hears of the pixels, and the
 * place it gives back when a tile arrives in a full pool (`tileReplay.ts`).
 *
 * - `heap`: the CPU LRU the tiles ran before the GPU rank (`webgpu/tile/pool.ts`): the feedback,
 *   capped and read back late, touches each tile asked at its own level — `ancestor`, the ancestor a
 *   streaming tile's pixels read too —; the least recently touched place untouched this frame and
 *   the one before is the victim.
 * - `rank`: the GPU stamp-and-rank (`gpu/pool/sortWgsl.ts`): every sampled pixel stamps the place it
 *   READ, uncapped, as it draws; the queue is cut each frame and read back `lag` frames later, a
 *   place re-occupied since the cut skipped. `rankOf` orders it: `poolRank` (log2 age steps × level)
 *   or `fineRank` (exact young ages).
 */
export type TilePolicy = {
  readonly name: string
  /** Frame `frame` drew: `places`, every place a sampled pixel read, stamped as the GPU would. */
  drew(frame: number, places: Iterable<number>): void
  /** The CPU's feedback pass at `frame` names `place`: the asked tile's own (`own`), or the
   *  ancestor its pixels read while it streams. */
  touched(frame: number, place: number, own: boolean): void
  /** The place a tile arriving at `frame` takes back; undefined when the policy gives none. */
  victim(frame: number): number | undefined
  placed(place: number, level: number, frame: number): void
  freed(place: number): void
  /** The frame ends: the GPU cuts its queue. */
  ended(frame: number): void
}

/** The CPU LRU over `places`, touched by the feedback; `ancestor`: the ancestor's touch too. */
export function heapPolicy(places: number, ancestor: boolean): TilePolicy {
  // A doubly linked list in last-touch order, `places` its sentinel.
  const prev = new Int32Array(places + 1).fill(-1),
    next = new Int32Array(places + 1).fill(-1),
    tier = new Int32Array(places)
  prev[places] = next[places] = places
  const unlink = (p: number) => {
    next[prev[p]] = next[p]
    prev[next[p]] = prev[p]
    prev[p] = next[p] = -1
  }
  const append = (p: number, frame: number) => {
    if (prev[p] >= 0) unlink(p)
    tier[p] = frame
    prev[p] = prev[places]
    next[p] = places
    next[prev[places]] = p
    prev[places] = p
  }
  return {
    name: ancestor ? 'heap + ancestor' : 'heap',
    drew() {},
    touched(frame, place, own) {
      if ((own || ancestor) && prev[place] >= 0) append(place, frame)
    },
    victim(frame) {
      const first = next[places]
      return first !== places && tier[first] < frame - 1 ? first : undefined
    },
    placed: (place, _level, frame) => append(place, frame),
    freed: (place) => unlink(place),
    ended() {},
  }
}

/** The finer rank (c): exact ages up to `EXACT`, then one step a doubling, in the same 1024 ranks:
 *  sixteen tiers — a texture's most levels — of sixty-four steps. */
const EXACT = 32,
  TIERS = 16
export const fineRank = (age: number, level: number, inUse: number) =>
  age < inUse
    ? POOL_RANKS
    : (age < EXACT ? age : Math.min(63, EXACT + ageStep(age) - ageStep(EXACT))) * TIERS +
      (TIERS - 1 - Math.min(level, TIERS - 1))

/** The GPU stamp-and-rank over `places`, its queue `burst` long, read `lag` frames after its cut,
 *  a place in use while read less than `inUse` frames ago. */
export function rankPolicy(
  places: number,
  options: {
    name: string
    rankOf?: (age: number, level: number, inUse: number) => number
    lag?: number
    burst?: number
    inUse?: number
  },
): TilePolicy {
  const { rankOf = poolRank, lag = 2, burst = 1024, inUse = EVICT_IN_USE } = options
  const use = new Float64Array(places),
    level = new Int32Array(places),
    placedAt = new Float64Array(places).fill(-1)
  const held = new Uint8Array(places)
  /** The queues cut, oldest first, and the one being read with its cursor. */
  const queues: { frame: number; places: number[] }[] = []
  let reading: { frame: number; places: number[] } | undefined,
    cursor = 0
  return {
    name: options.name,
    drew(frame, read) {
      for (const p of read) use[p] = Math.max(use[p], frame)
    },
    touched() {},
    victim(frame) {
      while (queues.length && queues[0].frame <= frame - lag) {
        reading = queues.shift()
        cursor = 0
      }
      if (!reading) return undefined
      while (cursor < reading.places.length) {
        const p = reading.places[cursor++]
        // Given back since, or taken again after the cut: not the place the queue ranked.
        if (held[p] && placedAt[p] <= reading.frame) return p
      }
      return undefined
    },
    placed(p, tileLevel, frame) {
      held[p] = 1
      use[p] = frame
      level[p] = tileLevel
      placedAt[p] = frame
    },
    freed: (p) => void (held[p] = 0),
    ended(frame) {
      const ranked: { p: number; rank: number }[] = []
      for (let p = 0; p < places; p++) {
        if (!held[p]) continue
        const rank = rankOf(frame - use[p], level[p], inUse)
        if (rank < POOL_RANKS) ranked.push({ p, rank })
      }
      ranked.sort((a, b) => b.rank - a.rank || a.p - b.p)
      queues.push({ frame, places: ranked.slice(0, burst).map(({ p }) => p) })
    },
  }
}
