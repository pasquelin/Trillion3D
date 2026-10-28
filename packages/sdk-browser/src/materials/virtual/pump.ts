import type { FrameClock } from '../../geometry/integration/frameBudget.ts'
import type { WebgpuTileAtlas } from './atlas/atlasTypes.ts'
import type { createTileSources } from './sources/sources.ts'
import type { createTileRequests, TileRequest } from './requests.ts'
import type { TileCounters } from './counters.ts'
import type { createResidencyBias } from './residencyBias.ts'

/** What a tile pass reads: the streamer's parts (`./streamer/streamer.ts`). */
type PumpParts = {
  device: GPUDevice
  clock: FrameClock
  budgetMs: number
  budgetBytes: number
  color: WebgpuTileAtlas
  sources: ReturnType<typeof createTileSources>
  requests: ReturnType<typeof createTileRequests>
  counters: TileCounters
  /** The textures' residency bias, followed once a bounded pass: a barrier reads the bias it found. */
  residency: ReturnType<typeof createResidencyBias>
  flushAll: () => void
  onFailure: (phase: string, error: unknown) => void
  /** Said once by a pass that landed a colour tile. */
  onColorChanged: () => void
}

/** The most tiles a pass lands, whatever their format: a fixed count a frame, the byte and the
 *  millisecond budgets being the host's ceilings above it. */
const MAX_TILES_PER_PASS = 32

/** Whether the tile `key` is at the coarsest tile level of its texture, the last below its tail: the level a card reads before the finer tiles come. */
const atCoarsestLevel = (atlas: TileRequest['atlas'], key: TileRequest['key']) =>
  key.level >= atlas.textures[key.slot].layout.tail - 1

/** What the source says of a request; a source that fails serves nothing and is no longer waited for: the coarse level holds, and the view is not kept from being still
 *  (nor an object from its cards, `texturesPending`) by a tile that will not come. */
function serveOrRefuse(
  p: PumpParts,
  request: TileRequest,
  at: number,
  open: () => GPUCommandEncoder,
): ReturnType<PumpParts['sources']['serve']> {
  try {
    return p.sources.serve(request.atlas, request.key, at, open)
  } catch (error) {
    p.onFailure('texture-tile-failed', error)
    return 'refused'
  }
}

/** Requests `from` to `to` of `list` are pending: those not resident (a resident tile is pending for no one). */
function leavePending(
  counters: PumpParts['counters'],
  list: readonly TileRequest[],
  from: number,
  to: number,
) {
  for (let left = from; left < to; left++) {
    const { atlas, key } = list[left]
    if (!atlas.resides(key)) counters.leave(atlas.kind, key.slot, atCoarsestLevel(atlas, key))
  }
}

/**
 * One pass: requested tiles — the feedback's in weight order, then those asked beside it
 * (`requests.ts`, `ask`) —, served until the tile count, the byte or the millisecond budget (the
 * pass's stage on the session's clock, capped by the host's ceiling) is spent; `unbounded` lifts
 * all three. They are read after each copy, the clock once: the first always lands, the one that
 * crosses a budget overshoots it — the peak says by how much. Returns what was served and what is
 * pending — waiting for its bytes, or deferred to the next pass; a pool refusal is neither — nothing will
 * come, the coarse level holds — and is counted.
 */
export const createTilePump =
  (p: PumpParts) =>
  (frame: number, unbounded = false) => {
    const { clock, sources, requests, counters } = p
    clock.stage(p.budgetMs)
    if (!unbounded) p.residency.follow(requests.coverageOf)
    let served = 0,
      bytes = 0,
      stop = false,
      colorLanded = false,
      encoder: GPUCommandEncoder | undefined
    const open = () =>
      (encoder ??= p.device.createCommandEncoder({ label: 'Trillion3D texture tiles' }))
    const wanted = requests.take(frame),
      at = requests.frame
    counters.worked = wanted.to > wanted.from || requests.askedCount > 0
    counters.clearMissing()
    /** One request served, unless it resides: counted, the budgets read after it. */
    const serve = (request: TileRequest) => {
      const { atlas, key } = request
      if (atlas.resides(key)) return
      const evicted = atlas.evictions
      const verdict = serveOrRefuse(p, request, at, open)
      // A place given up or taken changed the atlas's page table, whether or not the write after it
      // landed: the colour that follows it is told all the same.
      if (atlas === p.color && (atlas.evictions !== evicted || atlas.resides(key)))
        colorLanded = true
      if (verdict === 'waiting') counters.leave(atlas.kind, key.slot, atCoarsestLevel(atlas, key))
      else if (verdict === 'served') {
        served++
        bytes += request.atlas.poolOf(request.key.slot).tileBytes
        clock.spend()
        stop =
          !unbounded && (served >= MAX_TILES_PER_PASS || bytes >= p.budgetBytes || !clock.admits())
      }
    }
    /** Requests `from` to `to` of `list` served while the budgets allow; those they left are pending too (`leave`): offered again next
     *  image, they keep the view drawing. Returns the first one left. */
    const serveFrom = (list: readonly TileRequest[], from: number, to: number) => {
      let at = from
      for (; at < to && !stop; at++) serve(list[at])
      leavePending(counters, list, at, to)
      return at
    }
    // What the image shows first; then what a switch to come waits on, asked again next image.
    const index = serveFrom(wanted.list, wanted.from, wanted.to)
    serveFrom(requests.asked, 0, requests.askedCount)
    requests.clearAsked()
    sources.endPass(encoder, at)
    p.flushAll()
    requests.defer(index)
    counters.served += served
    counters.quiet = served || counters.pending ? 0 : counters.quiet + 1
    counters.deferred = requests.deferred
    counters.bytesLastFrame = bytes
    // What follows the landed colour tiles is the pass's cost too: timed before the clock stops.
    if (colorLanded) p.onColorChanged()
    counters.pass(clock.stageMs(), unbounded)
    clock.pause()
    return { served, pending: counters.pending }
  }
