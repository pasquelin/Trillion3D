import { levelSize, type TilePlace } from './textureTiles.ts';
import type { TextureLevelReader } from './textureLevelReader.ts';
import type { WebgpuTileAtlas } from './webgpuTileAtlas.ts';
import { createWebgpuTileLevels, type LevelKey } from './webgpuTileLevels.ts';
import { createTileScratch, type TileScratch } from './webgpuTileScratch.ts';
import type { TileKey } from './webgpuTilePageTable.ts';
import type { TileCounters } from './webgpuTileCounters.ts';
import {
  copyTailFromTexture,
  copyTileFromTexture,
  tileRegion,
  writeTileFromBitmap,
} from './webgpuTileWrite.ts';

/** Lectures de niveaux cuits en vol au plus : au-delà, une tuile attend l'image suivante. */
const MAX_LEVEL_READS = 6;
/** Textures de travail bâties au plus par passe — la source entière chacune ; les tuiles d'une
 *  troisième texture attendent la passe suivante. Elles vivent jusqu'à la soumission de la passe :
 *  une copie encodée nomme sa texture, qui ne peut pas être détruite avant. */
const MAX_SCRATCHES = 2;
/** Octets hôte des niveaux cuits décodés, tenus pour en découper d'autres tuiles. */
const LEVEL_CACHE_BYTES = 192 * 1024 * 1024;

/**
 * D'où les texels d'une tuile viennent, et comment ils atteignent le pool : un niveau cuit décodé
 * par le navigateur et tenu dans le cache de niveaux, ou une texture de travail bâtie depuis
 * l'image de l'hôte. Une tuile dont la source n'est pas encore en main n'est pas servie ; elle
 * repassera au retour suivant. La queue d'une texture de l'hôte passe par ici aussi, à la
 * préparation : sa texture de travail, la queue copiée, soumise, puis rendue — une source entière
 * à la fois, jamais toutes ensemble.
 */
export function createTileSources(options: {
  device: GPUDevice;
  readLevel?: TextureLevelReader;
  counters: TileCounters;
  onFailure: (phase: string, error: unknown) => void;
}) {
  const { device, counters } = options;
  const levels = options.readLevel
    ? createWebgpuTileLevels({
        read: options.readLevel,
        budgetBytes: LEVEL_CACHE_BYTES,
        onFailure: (key: LevelKey, error) =>
          options.onFailure(
            `texture-level-read-failed ${key.sha256}/${key.atlas}/${key.level}`,
            error,
          ),
      })
    : undefined;
  const scratches = new Map<string, TileScratch>();
  const scratchOf = (atlas: WebgpuTileAtlas, slot: number) => {
    const id = `${atlas.kind}/${slot}`;
    let scratch = scratches.get(id);
    if (scratch) return scratch;
    const { layout, source } = atlas.textures[slot];
    if (source.kind !== 'host') throw new Error('TEXTURE_SOURCE_NOT_HOST');
    if (scratches.size >= MAX_SCRATCHES) return undefined;
    scratch = createTileScratch(device, {
      map: source.map,
      rgba: source.rgba,
      width: layout.width,
      height: layout.height,
      format: atlas.pool.texture.format,
      errorCode:
        atlas.kind === 'color'
          ? 'MATERIAL_COLOR_TEXTURE_UNAVAILABLE'
          : 'MATERIAL_DATA_TEXTURE_UNAVAILABLE',
    });
    counters.scratches++;
    scratches.set(id, scratch);
    return scratch;
  };
  const dropScratches = () => {
    for (const scratch of scratches.values()) scratch.destroy();
    scratches.clear();
  };
  return {
    levels,
    /** Sert une tuile depuis sa source ; faux quand ses octets ne sont pas encore là. */
    serve(atlas: WebgpuTileAtlas, key: TileKey, frame: number, encoder: () => GPUCommandEncoder) {
      const { layout, source } = atlas.textures[key.slot];
      const [width, height] = levelSize(layout.width, layout.height, key.level);
      const region = tileRegion(width, height, key.tx, key.ty);
      if (source.kind === 'baked') {
        const levelKey = { sha256: source.sha256, atlas: source.atlas, level: key.level };
        const bitmap = levels?.get(levelKey, frame);
        if (!bitmap) {
          if (levels && levels.inFlight < MAX_LEVEL_READS) levels.request(levelKey, frame);
          return false;
        }
        const place = atlas.place(key, frame);
        if (!place) return false;
        writeTileFromBitmap(device.queue, atlas.pool.texture, place, bitmap, region);
        return true;
      }
      if (source.kind !== 'host') throw new Error('TEXTURE_TILE_WITHOUT_SOURCE');
      const scratch = scratchOf(atlas, key.slot);
      if (!scratch) return false;
      const place = atlas.place(key, frame);
      if (!place) return false;
      copyTileFromTexture(encoder(), atlas.pool.texture, place, scratch.texture, key.level, region);
      return true;
    },
    /** La queue d'une texture de l'hôte, copiée depuis sa texture de travail et soumise. */
    tail(atlas: WebgpuTileAtlas, slot: number, place: TilePlace) {
      const { layout } = atlas.textures[slot];
      const scratch = scratchOf(atlas, slot)!;
      const encoder = device.createCommandEncoder({ label: 'WG texture tail' });
      copyTailFromTexture(
        encoder,
        atlas.pool.texture,
        place,
        scratch.texture,
        [layout.width, layout.height],
        layout.tail,
        layout.last,
      );
      device.queue.submit([encoder.finish()]);
      dropScratches();
    },
    /** Fin de passe, après sa soumission : les textures de travail sont rendues. */
    endPass: dropScratches,
    settled: () => levels?.settled() ?? Promise.resolve(),
    destroy() {
      dropScratches();
      levels?.destroy();
    },
  };
}
