import { levelSize, type TilePlace } from '../../texture/tiles.ts';
import type { TextureLevelReader } from '../../texture/levelReader.ts';
import type { PoolEncoding } from '../../texture/blockFormats.ts';
import { writeTileFromBlocks } from './writeBlocks.ts';
import type { WebgpuTileAtlas } from './atlas.ts';
import { createWebgpuTileLevels, type LevelKey } from './levels.ts';
import type { TileScratch } from './scratch.ts';
import { buildHostScratch, createScratchBuilds } from './scratchBuilds.ts';
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
/** Working textures held at most per pass — the whole source each, built off the frame
 *  (`scratchBuilds.ts`); tiles of a third texture wait for a pass with room. They live until the
 *  pass is submitted: an encoded copy names its texture, which cannot be destroyed before. */
const MAX_SCRATCHES = 2;

/**
 * Where a tile's texels come from, and how they reach the pool of its lane: a cooked level decoded
 * by the browser, or a block tile's record as the file holds it, held in the level store, or a
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
  const build = (atlas: WebgpuTileAtlas, slot: number) =>
    buildHostScratch(device, counters, atlas, slot);
  const builds = createScratchBuilds(
    device,
    build,
    scratches.set.bind(scratches),
    options.onFailure,
  );
  /** A queue's working texture, built now: a queue is copied at prepare, never inside a pass. */
  const scratchOf = (atlas: WebgpuTileAtlas, slot: number) => {
    const id = scratchId(atlas, slot);
    let scratch = live.get(id) ?? scratches.get(id);
    if (!scratch) scratches.set(id, (scratch = build(atlas, slot)));
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
     * `refused`: the pool is full for this view, or the level does not fit beside the pages kept,
     * nothing will come — and nothing was read for it.
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
        const tile = [width, height, key.tx, key.ty] as const;
        const held = levels?.get(levelKey, tile);
        if (!held) {
          if (!atlas.roomFor(key.slot, frame)) return 'refused';
          const asked = levels && levels.inFlight < MAX_LEVEL_READS;
          // A level that cannot fit beside the pages kept will not come: refused, not waited for.
          return asked && !levels.request(levelKey, frame, tile) ? 'refused' : 'waiting';
        }
        const place = atlas.place(key, frame);
        if (!place) return 'refused';
        if (held instanceof Uint8Array)
          writeTileFromBlocks(device.queue, pool, place, held, region);
        else writeTileFromBitmap(device.queue, pool, place, held, region);
        return 'served';
      }
      if (source.kind !== 'host') throw new Error('TEXTURE_TILE_WITHOUT_SOURCE');
      const id = scratchId(atlas, key.slot),
        scratch = live.get(id) ?? scratches.get(id);
      if (!scratch) {
        if (scratches.size + builds.size < MAX_SCRATCHES) builds.ask(id, atlas, key.slot);
        return 'waiting';
      }
      const place = atlas.place(key, frame);
      if (!place) return 'refused';
      copyTileFromTexture(encoder(), pool, place, scratch.texture, key.level, region);
      return 'served';
    },
    /** Queue of a host texture, copied from its working texture and submitted. */
    tail(atlas: WebgpuTileAtlas, slot: number, place: TilePlace) {
      const { layout } = atlas.textures[slot];
      const scratch = scratchOf(atlas, slot);
      if (scratch.stale) scratch.reduce();
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
        scratch.reduce();
      }
      copyLiveTexture(device, atlas, slot, scratch.texture);
      return true;
    },
    /** A host texture whose readers' coverage rule moved (#42): its mips reduced again, copied. */
    reduce(atlas: WebgpuTileAtlas, slot: number) {
      if (!pictureFits(atlas.textures[slot])) return false;
      const kept = live.get(scratchId(atlas, slot)) ?? scratches.get(scratchId(atlas, slot)),
        scratch = kept ?? build(atlas, slot);
      scratch.reduce();
      copyLiveTexture(device, atlas, slot, scratch.texture);
      if (!kept) scratch.destroy();
      return true;
    },
    /** Bytes the live textures' working textures hold, mips included, beside the pool. */
    get liveBytes() {
      return liveBytes;
    },
    /** End of pass: its copies submitted, its working textures freed. */
    endPass(encoder?: GPUCommandEncoder) {
      if (encoder) device.queue.submit([encoder.finish()]);
      dropScratches();
    },
    /** True while a level read or a working texture's build is on its way: a tile may come. */
    get reading() {
      return (levels?.inFlight ?? 0) > 0 || builds.building !== undefined;
    },
    settled: () => Promise.all([levels?.settled(), builds.building]).then(() => undefined),
    destroy() {
      builds.destroy();
      dropScratches();
      for (const scratch of live.values()) scratch.destroy();
      live.clear();
      levels?.destroy();
    },
  };
}
