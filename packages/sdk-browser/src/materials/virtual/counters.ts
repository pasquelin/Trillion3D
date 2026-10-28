import type { TextureFrameMetrics } from '../../../../sdk-core/src/texture/metricsContracts.ts'
import type { WebgpuTileAtlas } from './atlas/atlasTypes.ts'
import type { HeldLevels } from '../texture/heldLevels.ts'
import type { WebgpuTilePool } from './pool/pool.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'

/**
 * Streamer counters, held flat by the pass and returned under the metrics contract: what image
 * feedback asked, what was served, what is missing. Nothing is estimated — a counter no pass has
 * fed is zero because nothing arrived, and a pool without a level reader publishes its reads as
 * `null`, never as zero.
 */
export function createTileCounters() {
  return {
    uploadedBytes: 0,
    served: 0,
    /** The tiles the last pass left pending (`leave`): the sum of `missing`. */
    pending: 0,
    /** Those of `pending` at the coarsest tile level of their texture: what the cache's cards read (`coarseMissing`), and what its light waits for. */
    pendingCoarse: 0,
    deferred: 0,
    requested: 0,
    atLevel: 0,
    missingAverage: 0,
    bytesLastFrame: 0,
    scratches: 0,
    /** True when the last pass had tiles to serve. */
    worked: false,
    /** The tiles the last pass left pending, counted by texture, a slot of each atlas: waiting for their bytes, or deferred to the next pass
     *  (`leave`). `pending` is their sum. Held flat, grown with the slots met, never made again per pass. */
    missing: { color: new Uint32Array(0), data: new Uint32Array(0) },
    /** The same count, of the tiles at the coarsest tile level of their texture alone. */
    missingCoarse: { color: new Uint32Array(0), data: new Uint32Array(0) },
    /** A pass begins: no tile is pending yet. */
    clearMissing() {
      this.missing.color.fill(0)
      this.missing.data.fill(0)
      this.missingCoarse.color.fill(0)
      this.missingCoarse.data.fill(0)
      this.pending = 0
      this.pendingCoarse = 0
    },
    /** A tile of texture `slot` of the atlas of `kind` is left pending, `coarse` where it is at the coarsest tile level of its texture: the one place a pending tile is counted. */
    leave(kind: 'color' | 'data', slot: number, coarse: boolean) {
      const held = (this.missing[kind] = resized(this.missing[kind], slot + 1))
      held[slot]++
      this.pending++
      if (!coarse) return
      const heldCoarse = (this.missingCoarse[kind] = resized(this.missingCoarse[kind], slot + 1))
      heldCoarse[slot]++
      this.pendingCoarse++
    },
    /** Whether the texture at `slot` of the atlas of `kind` has its coarsest tile level pending: what a card captured from a surface that wears it would read short. */
    coarseMissing(kind: 'color' | 'data', slot: number) {
      return this.missingCoarse[kind][slot] > 0
    },
    /** What the last pass cost, on the one clock its budget is read on — the `tilesPumpMs` CPU
     *  step files it, never a second bracket — and the worst bounded pass of the session. Both are
     *  `null` for a barrier pass: it lifts the budget and is not a frame's cost. */
    lastMs: null as number | null,
    peakMs: null as number | null,
    pass(ms: number, unbounded: boolean) {
      this.lastMs = unbounded ? null : ms
      if (!unbounded && ms > (this.peakMs ?? -1)) this.peakMs = ms
    },
    metrics(
      atlases: readonly WebgpuTileAtlas[],
      reads: { levels?: Pick<HeldLevels, 'inFlight' | 'fetched' | 'bytes'>; liveBytes: number },
      family: string,
    ) {
      return tileMetrics(this, atlases, reads, family)
    },
  }
}

/** The counters a pass fed, read by the metrics. */
interface FedCounters {
  requested: number
  atLevel: number
  missingAverage: number
  pending: number
  deferred: number
  served: number
  bytesLastFrame: number
  worked: boolean
  lastMs: number | null
  peakMs: number | null
  scratches: number
}

function tileMetrics(
  counters: FedCounters,
  atlases: readonly WebgpuTileAtlas[],
  {
    levels,
    liveBytes,
  }: { levels?: Pick<HeldLevels, 'inFlight' | 'fetched' | 'bytes'>; liveBytes: number },
  family: string,
) {
  const sum = (of: (atlas: WebgpuTileAtlas) => number) =>
    atlases.reduce((total, atlas) => total + of(atlas), 0)
  const pools = (of: (pool: WebgpuTilePool) => number) =>
    sum((atlas) => atlas.pools.reduce((total, pool) => total + of(pool), 0))
  return {
    texturePoolBytes: pools((pool) => pool.bytes),
    texturePoolFormat: family,
    texturePoolLayers: pools((pool) => pool.layers),
    textureTilesResident: pools((pool) => pool.resident),
    textureResidentBytes: pools((pool) => pool.residentBytes),
    textureTilesRequested: counters.requested,
    textureTilesAtLevel: counters.atLevel,
    textureMissingLevels: counters.missingAverage,
    textureTilesPending: counters.pending,
    textureTilesDeferred: counters.deferred,
    textureTilesServed: counters.served,
    textureTilesEvicted: sum((atlas) => atlas.evictions),
    textureTilesRefused: sum((atlas) => atlas.refused),
    textureBytesLastFrame: counters.bytesLastFrame,
    textureUploadMs: counters.worked ? counters.lastMs : null,
    textureUploadPeakMs: counters.peakMs,
    textureLevelReads: levels ? levels.inFlight : null,
    textureLevelsDecoded: levels ? levels.fetched : null,
    textureLevelCacheBytes: levels ? levels.bytes : null,
    textureScratchBuilds: counters.scratches,
    textureLiveBytes: liveBytes,
  } satisfies TextureFrameMetrics
}

export type TileCounters = ReturnType<typeof createTileCounters>
