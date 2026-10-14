import type { FrameClock } from '../../page/integration/frameBudget.ts'
import type { WebgpuTileAtlas } from './atlasTypes.ts'
import type { createTileSources } from './sources.ts'
import type { createTileRequests } from './requests.ts'
import type { createCardTiles } from './cardTiles.ts'
import type { TileCounters } from './counters.ts'

/** What a tile pass reads: the streamer's parts (`./streamer.ts`). */
type PumpParts = {
  device: GPUDevice
  clock: FrameClock
  budgetMs: number
  budgetBytes: number
  color: WebgpuTileAtlas
  /** Colour textures the pass served or evicted a tile of, named once each. */
  colorChanged: Set<number>
  sources: ReturnType<typeof createTileSources>
  requests: ReturnType<typeof createTileRequests>
  cards: ReturnType<typeof createCardTiles>
  counters: TileCounters
  flushAll: () => void
  onFailure: (phase: string, error: unknown) => void
  onColorChanged: (slots: ReadonlySet<number>) => void
}

/**
 * One pass: requested tiles, served in weight order until the byte or the millisecond budget (the
 * pass's stage on the session's clock, capped by the host's ceiling) is spent; `unbounded` lifts
 * both. Both are read after each copy, the clock once: the first always lands, the one that crosses
 * a budget overshoots it — the peak says by how much. Returns what was served and what is pending —
 * waiting for its bytes, or deferred to the next pass; a pool refusal is neither — nothing will
 * come, the coarse level holds — and is counted.
 */
export const createTilePump =
  (p: PumpParts) =>
  (frame: number, unbounded = false) => {
    const { clock, sources, requests, counters, colorChanged } = p
    clock.stage(p.budgetMs)
    let served = 0,
      waiting = 0,
      bytes = 0,
      stop = false,
      encoder: GPUCommandEncoder | undefined
    colorChanged.clear()
    const open = () =>
      (encoder ??= p.device.createCommandEncoder({ label: 'Trillion3D texture tiles' }))
    const pinned = p.cards.pass(),
      wanted = requests.take(frame),
      at = requests.frame
    counters.worked = wanted.to > wanted.from
    let index = wanted.from
    for (; index < wanted.to && !stop; index++) {
      const request = wanted.list[index]
      // A tile both asked and named by a pass deferred lands once.
      if (request.atlas.resides(request.key)) continue
      let verdict: ReturnType<typeof sources.serve> = 'waiting'
      try {
        verdict = sources.serve(request.atlas, request.key, at, open)
      } catch (error) {
        p.onFailure('texture-tile-failed', error)
      }
      if (verdict === 'waiting') waiting++
      else if (verdict === 'served') {
        served++
        bytes += request.atlas.poolOf(request.key.slot).tileBytes
        if (request.atlas === p.color) colorChanged.add(request.key.slot)
        clock.spend()
        stop = !unbounded && (bytes >= p.budgetBytes || !clock.admits())
      }
    }
    sources.endPass(encoder, at)
    p.flushAll()
    requests.defer(index)
    counters.served += served
    counters.deferred = requests.deferred
    counters.pending = waiting + requests.deferred
    counters.bytesLastFrame = bytes
    p.cards.served(served, pinned)
    // The shadows that follow the landed tiles are the pass's cost too: timed before the clock stops.
    if (colorChanged.size) p.onColorChanged(colorChanged)
    counters.pass(clock.stageMs(), unbounded)
    clock.pause()
    return { served, pending: counters.pending }
  }
