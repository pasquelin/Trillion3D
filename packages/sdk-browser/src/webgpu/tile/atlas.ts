import { entryLevel } from '../../texture/tiles.ts';
import type { TileTexture } from './tileTexture.ts';
import { createWebgpuTilePageTable } from './pageTable.ts';
import { writeTailFromBytes } from './write.ts';
import { writeTailFromBlocks } from './writeBlocks.ts';
import type { LaneCounts, PoolEncoding } from '../../texture/blockFormats.ts';
import { createTileLanes, type Lane } from './lanes.ts';
import { tailId, tileId } from './ids.ts';
import { evictTile } from './atlasResize.ts';
import { releaseTileSlot } from './release.ts';
import { regrownPageTable } from './regrow.ts';

/**
 * A virtual-texture atlas: one pool per lane, its page table and its catalogue. It knows which
 * tile resides where, which to give its place up, and it keeps the table current; what a tile
 * contains and where that comes from is the streamer's business. A texture's tiles and tail live
 * in the pool of its lane, and the shader reads the lane in the texture's header.
 */
export type { WebgpuTileAtlas } from './atlasTypes.ts';
import type { WebgpuTileAtlas } from './atlasTypes.ts';

export function createWebgpuTileAtlas(
  device: Pick<GPUDevice, 'createTexture' | 'createBuffer' | 'queue'>,
  options: {
    kind: 'color' | 'data';
    encoding: PoolEncoding;
    layers: LaneCounts;
    feedbackOffset: number;
    textures: TileTexture[];
    /** A tile gave its place up: the texture it belonged to, for whoever reads it to follow. */
    onEvicted?: (slot: number) => void;
  },
): WebgpuTileAtlas {
  const { kind, textures, encoding, feedbackOffset } = options;
  const lanes = createTileLanes(device, options);
  let views = lanes.views(),
    pools = lanes.pools();
  const layouts = () => textures.map((texture) => texture.layout);
  let pages = createWebgpuTilePageTable(device, layouts(), { kind, feedbackOffset });
  const vacant = new Set<number>();
  const relayout = (offset: number, replaced = -1) => {
    pages = regrownPageTable(device, pages, layouts(), { kind, feedbackOffset: offset }, replaced);
    views = lanes.views();
  };
  let evictions = 0,
    refused = 0,
    victimsFrame = -1;
  // Eviction victims, queued once per image and per lane, taken in order.
  const victimsOf = (lane: Lane, frame: number) => {
    if (victimsFrame !== frame) {
      for (const each of lanes.lanes.values()) each.victims = each.pool.victims(frame);
      victimsFrame = frame;
    }
    return lane.victims;
  };
  const evict = (lane: Lane, frame: number) => {
    const index = victimsOf(lane, frame).take();
    if (index === undefined) return undefined;
    evictTile(lane.pool, index, { pages, resident: lane.resident }, options.onEvicted);
    evictions++;
    return index;
  };
  /** The white fill never opens a lane (`laneDemand`): until a map opens its own, it takes no
   *  layer and reads the white stand-in (`lanes.ts`). */
  const fillWaits = () => !lanes.lanes.has(textures[0].lane);
  const pinTails: WebgpuTileAtlas['pinTails'] = (
    queue,
    fromHost,
    from = 0,
    to = textures.length,
  ) => {
    for (let slot = from; slot < to; slot++) {
      const { layout, source, lane, retired } = textures[slot];
      if (retired) continue;
      if (slot === 0 && fillWaits()) {
        pages.setTail(0, { x: 0, y: 0, layer: 0 }, encoding.tapOf(lane));
        continue;
      }
      const pool = lanes.of(slot).pool;
      // The floor holds every tail (`texturePoolFor`): a pool drawn under it refuses by name.
      const index = pool.acquire(tailId(slot), 0, true);
      if (index === undefined) throw new Error('TEXTURE_POOL_UNDER_FLOOR');
      const place = pool.placeOf(index);
      if (source.kind === 'host') fromHost(slot, place);
      else
        (lane === 'lossless' ? writeTailFromBytes : writeTailFromBlocks)(
          queue,
          pool.texture,
          place,
          [layout.width, layout.height],
          layout.tail,
          encoding.tailOf(source.tail, lane),
        );
      pages.setTail(slot, place, encoding.tapOf(lane));
    }
  };
  return {
    kind,
    get pools() {
      return pools;
    },
    get views() {
      return views;
    },
    get pages() {
      return pages;
    },
    textures,
    get evictions() {
      return evictions;
    },
    get refused() {
      return refused;
    },
    poolOf: (slot) => lanes.of(slot).pool,
    residentIn: (lane) => lanes.lanes.get(lane)?.pool.resident ?? 0,
    pinTails,
    append(texture) {
      const slot = vacant.values().next().value ?? textures.length;
      const previous = textures[slot];
      textures[slot] = texture;
      try {
        relayout(pages.words[0], slot);
      } catch (error) {
        if (previous) textures[slot] = previous;
        else textures.pop();
        throw error;
      }
      vacant.delete(slot);
      return slot;
    },
    release(slot) {
      releaseTileSlot(lanes.of(slot), slot);
      vacant.add(slot);
      // Keep the layout until reuse: dropping allocates no GPU buffer and stale feedback
      // remains decodable, but retired slots are never served.
      textures[slot] = {
        ...textures[slot],
        texture: undefined,
        source: textures[0].source,
        retired: true,
      };
      victimsFrame = -1;
    },
    relayout,
    touch(key, frame) {
      const lane = lanes.of(key.slot),
        index = lane.resident.get(tileId(key));
      if (index === undefined) return false;
      lane.pool.touch(index, frame);
      return true;
    },
    roomFor(slot, frame) {
      const lane = lanes.of(slot);
      if (lane.pool.resident < lane.pool.tiles || victimsOf(lane, frame).length > 0) return true;
      refused++;
      return false;
    },
    place(key, frame) {
      const lane = lanes.of(key.slot),
        id = tileId(key);
      // A free place, otherwise the one the least looked-at just gave back.
      let index = lane.pool.acquire(id, frame);
      if (index === undefined && evict(lane, frame) !== undefined)
        index = lane.pool.acquire(id, frame);
      if (index === undefined) {
        refused++;
        return undefined;
      }
      lane.resident.set(id, index);
      const place = lane.pool.placeOf(index);
      pages.setTile(key, place);
      return place;
    },
    servedLevel(key) {
      const word = pages.entryOf(key);
      return word === 0 ? textures[key.slot].layout.tail : entryLevel(word);
    },
    flush: (target) => pages.flush(target),
    resize(target, layers) {
      const fillLane = lanes.lanes.get(textures[0].lane);
      // The fill follows its lane: its place given back as it closes, pinned as it opens or closes.
      if (fillLane && layers[textures[0].lane] === 0) releaseTileSlot(fillLane, 0);
      const waited = fillWaits(),
        result = lanes.resize(target, layers, pages);
      if (waited !== fillWaits()) pinTails(target.queue, () => {}, 0, 1);
      if (result.replaced) {
        views = lanes.views();
        pools = lanes.pools();
      }
      evictions += result.evicted;
      victimsFrame = -1;
      return result;
    },
    destroy() {
      pages.destroy();
      lanes.destroy();
    },
  };
}
