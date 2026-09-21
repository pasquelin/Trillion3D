import { levelSize, type TilePlace } from './textureTiles.ts';
import type { TextureLevelReader } from './textureLevelReader.ts';
import type { PoolEncoding } from './textureBlockFormats.ts';
import { checkLevelBlocks, writeTileFromBlocks } from './webgpuTileWriteBlocks.ts';
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

/** Cooked-level reads in flight at most: beyond that, a tile waits for the next image. */
const MAX_LEVEL_READS = 6;
/** Working textures built at most per pass — the whole source each; tiles of a third texture wait
 *  for the next pass. They live until the pass is submitted: an encoded copy names its texture, which
 *  cannot be destroyed before. */
const MAX_SCRATCHES = 2;
/** Host bytes of decoded cooked levels, held to cut more tiles from them. */
const LEVEL_CACHE_BYTES = 192 * 1024 * 1024;

/**
 * Where a tile's texels come from, and how they reach the pool of its lane: a cooked level —
 * decoded by the browser, or block-compressed as the file holds it — held in the level cache, or a
 * working texture built from the host image, which only the lossless lane receives. A tile whose
 * source is not yet in hand is not served; it will come back on the next feedback. A host texture's
 * queue goes through here too, at prepare: its working texture, the queue copied, submitted, then
 * returned — one whole source at a time, never all together.
 */
export function createTileSources(options: {
  device: GPUDevice;
  readLevel?: TextureLevelReader;
  /** Which level file each lane samples: a family's blocks, or the lossless one. */
  encoding: PoolEncoding;
  counters: TileCounters;
  onFailure: (phase: string, error: unknown) => void;
}) {
  const { device, counters, encoding } = options;
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
      format: atlas.poolOf(slot).texture.format,
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
    /**
     * Serves a tile from its source. `waiting`: its bytes are not there yet, it will come back;
     * `refused`: the pool is full for this view, nothing will come — and nothing was read for it.
     */
    serve(
      atlas: WebgpuTileAtlas,
      key: TileKey,
      frame: number,
      encoder: () => GPUCommandEncoder,
    ): 'served' | 'waiting' | 'refused' {
      const { layout, source, lane } = atlas.textures[key.slot];
      const pool = atlas.poolOf(key.slot).texture;
      const [width, height] = levelSize(layout.width, layout.height, key.level);
      const region = tileRegion(width, height, key.tx, key.ty);
      if (source.kind === 'baked') {
        const levelKey = {
          sha256: source.sha256,
          atlas: source.atlas,
          level: key.level,
          format: encoding.levelFormat(lane),
        };
        const held = levels?.get(levelKey, frame);
        if (!held) {
          if (!atlas.roomFor(key.slot, frame)) return 'refused';
          if (levels && levels.inFlight < MAX_LEVEL_READS) levels.request(levelKey, frame);
          return 'waiting';
        }
        // A level of the wrong length is refused before a slot is taken: placed first, the tile
        // would stay resident over the texels its slot held before.
        if (held instanceof Uint8Array) checkLevelBlocks(held, [width, height]);
        const place = atlas.place(key, frame);
        if (!place) return 'refused';
        if (held instanceof Uint8Array)
          writeTileFromBlocks(device.queue, pool, place, held, [width, height], region);
        else writeTileFromBitmap(device.queue, pool, place, held, region);
        return 'served';
      }
      if (source.kind !== 'host') throw new Error('TEXTURE_TILE_WITHOUT_SOURCE');
      const scratch = scratchOf(atlas, key.slot);
      if (!scratch) return 'waiting';
      const place = atlas.place(key, frame);
      if (!place) return 'refused';
      copyTileFromTexture(encoder(), pool, place, scratch.texture, key.level, region);
      return 'served';
    },
    /** Queue of a host texture, copied from its working texture and submitted. */
    tail(atlas: WebgpuTileAtlas, slot: number, place: TilePlace) {
      const { layout } = atlas.textures[slot];
      const scratch = scratchOf(atlas, slot)!;
      const encoder = device.createCommandEncoder({ label: 'WG texture tail' });
      copyTailFromTexture(
        encoder,
        atlas.poolOf(slot).texture,
        place,
        scratch.texture,
        [layout.width, layout.height],
        layout.tail,
        layout.last,
      );
      device.queue.submit([encoder.finish()]);
      dropScratches();
    },
    /** End of pass, after its submit: working textures are returned. */
    endPass: dropScratches,
    settled: () => levels?.settled() ?? Promise.resolve(),
    destroy() {
      dropScratches();
      levels?.destroy();
    },
  };
}
