import type { TextureFrameMetrics } from '../sdk-core/src/index.ts';
import type { WebgpuTileAtlas } from './webgpuTileAtlas.ts';
import type { WebgpuTileLevels } from './webgpuTileLevels.ts';
import type { WebgpuTilePool } from './webgpuTilePool.ts';

/**
 * Streamer counters, held flat by the pass and returned under the metrics contract: what image
 * feedback asked, what was served, what is missing. Nothing is estimated — a counter no pass has
 * fed is zero because nothing arrived, and a pool without a level reader publishes its reads as
 * `null`, never as zero.
 */
export function createTileCounters() {
  return {
    served: 0,
    pending: 0,
    deferred: 0,
    requested: 0,
    atLevel: 0,
    missingAverage: 0,
    bytesLastFrame: 0,
    scratches: 0,
    /** True when the last pass had tiles to serve. */
    worked: false,
    /** What the last pass cost, on the one clock its budget is read on — the `tilesPumpMs` CPU
     *  step files it, never a second bracket — and the worst bounded pass of the session. Both are
     *  `null` for a barrier pass: it lifts the budget and is not a frame's cost. */
    lastMs: null as number | null,
    peakMs: null as number | null,
    pass(ms: number, unbounded: boolean) {
      this.lastMs = unbounded ? null : ms;
      if (!unbounded && ms > (this.peakMs ?? -1)) this.peakMs = ms;
    },
    metrics(
      atlases: readonly WebgpuTileAtlas[],
      levels: WebgpuTileLevels | undefined,
      family: string,
    ) {
      const sum = (of: (atlas: WebgpuTileAtlas) => number) =>
        atlases.reduce((total, atlas) => total + of(atlas), 0);
      const pools = (of: (pool: WebgpuTilePool) => number) =>
        sum((atlas) => atlas.pools.reduce((total, pool) => total + of(pool), 0));
      const metrics: TextureFrameMetrics = {
        texturePoolBytes: pools((pool) => pool.bytes),
        texturePoolFormat: family,
        texturePoolLayers: pools((pool) => pool.layers),
        textureTilesResident: pools((pool) => pool.resident),
        textureResidentBytes: pools((pool) => pool.residentBytes),
        textureTilesRequested: this.requested,
        textureTilesAtLevel: this.atLevel,
        textureMissingLevels: this.missingAverage,
        textureTilesPending: this.pending,
        textureTilesDeferred: this.deferred,
        textureTilesServed: this.served,
        textureTilesEvicted: sum((atlas) => atlas.evictions),
        textureTilesRefused: sum((atlas) => atlas.refused),
        textureBytesLastFrame: this.bytesLastFrame,
        textureUploadMs: this.worked ? this.lastMs : null,
        textureUploadPeakMs: this.peakMs,
        textureLevelReads: levels ? levels.inFlight : null,
        textureLevelsDecoded: levels ? levels.fetched : null,
        textureLevelCacheBytes: levels ? levels.bytes : null,
        textureScratchBuilds: this.scratches,
      };
      return metrics;
    },
  };
}

export type TileCounters = ReturnType<typeof createTileCounters>;
