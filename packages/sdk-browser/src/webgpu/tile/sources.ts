import { levelSize, type TilePlace } from '../../texture/tiles.ts';
import type { TextureLevelReader } from '../../texture/levelReader.ts';
import type { PoolEncoding } from '../../texture/blockFormats.ts';
import { writeTileFromBlocks } from './writeBlocks.ts';
import type { WebgpuTileAtlas } from './atlas.ts';
import { createWebgpuTileLevels, type LevelKey } from './levels.ts';
import { createTileScratch, type TileScratch } from './scratch.ts';
import { copyLiveTexture, pictureFits } from './live.ts';
import type { TileKey } from './pageTable.ts';
import type { TileCounters } from './counters.ts';
import {
  copyTailFromTexture,
  copyTileFromTexture,
  tileRegion,
  writeTileFromBitmap,
} from './write.ts';

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
  /** A working texture's key: its slot and atlas as one number, nothing built per copy. */
  const scratchId = (atlas: WebgpuTileAtlas, slot: number) =>
    slot * 2 + (atlas.kind === 'color' ? 0 : 1);
  const scratches = new Map<number, TileScratch>();
  /** Working textures of the live host textures, kept from pass to pass, and their bytes (#362). */
  const live = new Map<number, TileScratch>();
  let liveBytes = 0;
  const build = (atlas: WebgpuTileAtlas, slot: number) => {
    const { layout, source } = atlas.textures[slot];
    if (source.kind !== 'host') throw new Error('TEXTURE_SOURCE_NOT_HOST');
    counters.scratches++;
    return createTileScratch(device, {
      map: source.map,
      width: layout.width,
      height: layout.height,
      format: atlas.poolOf(slot).texture.format,
      errorCode:
        atlas.kind === 'color'
          ? 'MATERIAL_COLOR_TEXTURE_UNAVAILABLE'
          : 'MATERIAL_DATA_TEXTURE_UNAVAILABLE',
      coverage: source.coverage,
    });
  };
  const scratchOf = (atlas: WebgpuTileAtlas, slot: number) => {
    const id = scratchId(atlas, slot);
    let scratch = live.get(id) ?? scratches.get(id);
    if (scratch) return scratch;
    if (atlas.textures[slot].source.kind !== 'host') throw new Error('TEXTURE_SOURCE_NOT_HOST');
    if (scratches.size >= MAX_SCRATCHES) return undefined;
    scratches.set(id, (scratch = build(atlas, slot)));
    return scratch;
  };
  const copyIntoPlaces = (atlas: WebgpuTileAtlas, slot: number, scratch: TileScratch) => {
    const encoder = device.createCommandEncoder({ label: 'Trillion3D live texture' });
    copyLiveTexture(encoder, atlas, slot, scratch.texture);
    device.queue.submit([encoder.finish()]);
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
          if (levels && levels.inFlight < MAX_LEVEL_READS)
            levels.request(levelKey, frame, [width, height]);
          return 'waiting';
        }
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
      const encoder = device.createCommandEncoder({ label: 'Trillion3D texture tail' });
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
    /**
     * A host texture's new picture (#362): the texture turns live — it keeps one working texture
     * of its own size, refilled in place from now on —, and its tail and resident tiles are
     * copied again from it, in one submit. A texture whose picture never moves never gets here;
     * one whose size moved is not copied — false —: only a new session lays its tiles out again.
     */
    refresh(atlas: WebgpuTileAtlas, slot: number) {
      if (!pictureFits(atlas.textures[slot])) return false;
      const id = scratchId(atlas, slot);
      let scratch = live.get(id);
      if (scratch) scratch.fill();
      else {
        live.set(id, (scratch = build(atlas, slot)));
        liveBytes += scratch.bytes;
      }
      copyIntoPlaces(atlas, slot, scratch);
      return true;
    },
    /** A host texture whose readers' coverage rule moved (#42): its mips reduced again, copied. */
    reduce(atlas: WebgpuTileAtlas, slot: number) {
      if (!pictureFits(atlas.textures[slot])) return false;
      const id = scratchId(atlas, slot),
        kept = live.get(id) ?? scratches.get(id),
        scratch = kept ?? build(atlas, slot);
      kept?.reduce();
      copyIntoPlaces(atlas, slot, scratch);
      if (!kept) scratch.destroy();
      return true;
    },
    /** Bytes the live textures' working textures hold, mips included, beside the pool. */
    get liveBytes() {
      return liveBytes;
    },
    /** End of pass, after its submit: working textures are returned, the live ones kept. */
    endPass: dropScratches,
    settled: () => levels?.settled() ?? Promise.resolve(),
    destroy() {
      dropScratches();
      for (const scratch of live.values()) scratch.destroy();
      live.clear();
      levels?.destroy();
    },
  };
}
