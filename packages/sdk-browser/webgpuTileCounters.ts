import type { TextureFrameMetrics } from '../sdk-core/index.ts';
import type { WebgpuTileAtlas } from './webgpuTileAtlas.ts';
import type { WebgpuTileLevels } from './webgpuTileLevels.ts';

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
    requested: 0,
    atLevel: 0,
    missingAverage: 0,
    bytesLastFrame: 0,
    scratches: 0,
    /** True when the last pass had image feedback to serve. */
    worked: false,
    metrics(atlases: readonly WebgpuTileAtlas[], levels: WebgpuTileLevels | undefined) {
      const sum = (of: (atlas: WebgpuTileAtlas) => number) =>
        atlases.reduce((total, atlas) => total + of(atlas), 0);
      const metrics: TextureFrameMetrics = {
        texturePoolBytes: sum((atlas) => atlas.pool.bytes),
        texturePoolLayers: atlases[0]?.pool.layers ?? null,
        textureTilesResident: sum((atlas) => atlas.pool.resident),
        textureResidentBytes: sum((atlas) => atlas.pool.residentBytes),
        textureTilesRequested: this.requested,
        textureTilesAtLevel: this.atLevel,
        textureMissingLevels: this.missingAverage,
        textureTilesPending: this.pending,
        textureTilesServed: this.served,
        textureTilesEvicted: sum((atlas) => atlas.evictions),
        textureTilesRefused: sum((atlas) => atlas.refused),
        textureBytesLastFrame: this.bytesLastFrame,
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
