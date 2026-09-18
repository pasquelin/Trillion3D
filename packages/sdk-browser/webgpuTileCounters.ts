import type { TextureFrameMetrics } from '../sdk-core/index.ts';
import type { WebgpuTileAtlas } from './webgpuTileAtlas.ts';
import type { WebgpuTileLevels } from './webgpuTileLevels.ts';

/**
 * Les compteurs du diffuseur, tenus à plat par la passe et rendus sous le contrat des métriques :
 * ce que le retour d'image a demandé, ce qui a été servi, ce qui manque. Rien n'est estimé — un
 * compteur qu'aucune passe n'a nourri vaut zéro parce que rien n'est arrivé, et le pool sans
 * lecteur de niveaux publie ses lectures à `null`, jamais à zéro.
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
    /** Vrai quand la dernière passe avait un retour d'image à servir, et ce qu'elle a coûté. */
    worked: false,
    lastMs: 0,
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
