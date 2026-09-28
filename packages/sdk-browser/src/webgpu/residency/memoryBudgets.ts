import { poolLayerBytes, tileBytes, TILES_PER_LAYER } from '../../texture/tiles.ts';
import {
  laneCounts,
  POOL_LANES,
  type AtlasLanes,
  type BlockChoice,
  type LaneCounts,
  type PoolEncoding,
  type PoolLane,
} from '../../texture/blockFormats.ts';
import { checkTexturePoolBudget, type PoolClamp } from '../../residency/pools.ts';

/** 512 MiB, split equally between the colour atlas and the data atlas, in 64 MiB layers. */
export const DEFAULT_TEXTURE_POOL_BUDGET = 512 * 1024 * 1024;
/** The two budgets of a frame's tile pass. Bytes: 16 MiB of tiles copied into the pools.
 *  Milliseconds: the same order as the shadow stage's budget, the reference's fixed number of tile
 *  uploads per frame in the frame's own unit. What they defer shows its coarser resident level
 *  until the next pass. */
export const DEFAULT_TEXTURE_TRANSFER_BYTES = 16 * 1024 * 1024;
export const DEFAULT_TEXTURE_UPLOAD_MS = 1;

/** A tile pass budget for what the host declared: the default when it declared nothing finite,
 *  never below `floor` — one byte, or zero milliseconds: one tile per pass still lands. */
const budgetFor = (declared: number | undefined, fallback: number, floor: number) =>
  Math.max(floor, Number.isFinite(declared) ? declared! : fallback);
export const textureTransferBytesFor = (declared: number | undefined) =>
  budgetFor(declared, DEFAULT_TEXTURE_TRANSFER_BYTES, 1);
export const textureUploadMsFor = (declared: number | undefined) =>
  budgetFor(declared, DEFAULT_TEXTURE_UPLOAD_MS, 0);

/** The texture pool as it stands: budget and bytes held. */ export type TexturePool = {
  /** Bytes allowed. */ budgetBytes: number;
  /** Layers of each lane pool, per atlas, and the bytes of every pool added up. */
  layers: AtlasLanes;
  /** Tiles each lane pool may hold, per atlas: its layers' places, or fewer when the budget is
   *  under the layers' floor — the budget is then held tile by tile. */
  tiles: AtlasLanes;
  /** Bytes held. */ allocatedBytes: number;
  /** Why the size was limited. */ clamp: PoolClamp;
};

/**
 * What prepare settles once, with the sidecar's chains and the catalogue in hand: the family the
 * session samples, its encoding, and the lane pools on the lanes' demand; `poolFor` draws the
 * same pools for another budget (`setMemoryBudgets`). Setup holds only the budget until then.
 */
export type TexturePools = {
  choice: BlockChoice;
  encoding: PoolEncoding;
  pool: TexturePool;
  poolFor(budgetBytes: number): TexturePool;
  /** Bytes of the live textures' working textures the pool was drawn without (#362). */
  liveBytes?: number;
};

/**
 * Layers of each lane pool that the texture-pool budget yields: half the budget per atlas; in an
 * atlas every lane that has textures gets its floor — the layers the tails of its textures take,
 * one tile each, kept resident whole (`tails`), as the geometry pool holds its root cover, plus
 * one tile to stream into when the lane has streamed tiles —, then the rest in proportion to the
 * bytes its textures would take resident, a block texel costing a quarter of an RGBA8 one, and
 * never more layers than its tiles need, what a capped lane leaves going to the others (`scene`
 * when every lane is served under the budget). A lane no texture takes has no layer. A budget
 * under the floor keeps the floor's layers but is held tile by tile: each lane may hold the tiles
 * its share pays for (`tiles`), never fewer than its tails and one to stream into — raised to
 * those, by name (`minimum`). Above the layer count the device accepts,
 * a lane is brought back to that limit, by name. Only the device limit can refuse, when even the
 * tails do not fit (`TEXTURE_POOL_DEVICE_LIMIT`).
 */
export function texturePoolFor(
  budgetBytes: number,
  device: { limits?: { maxTextureArrayLayers?: number } } | undefined,
  /** Tiles each lane's textures would hold at full residency — tails and streamed entries. */
  demand: AtlasLanes,
  texelBytes: (lane: PoolLane) => number,
  /** Textures each lane holds: one tail each, never evicted. */
  tails: AtlasLanes,
): TexturePool {
  checkTexturePoolBudget(budgetBytes);
  const limit = device?.limits?.maxTextureArrayLayers;
  const clamps = new Set<PoolClamp>();
  const layerBytes = (lane: PoolLane) => poolLayerBytes(texelBytes(lane));
  const layersFor = (tiles: number) => Math.ceil(tiles / TILES_PER_LAYER);
  const atlas = (lanes: LaneCounts, kept: LaneCounts) => {
    const layers = laneCounts();
    const open = new Set(POOL_LANES.filter((lane) => lanes[lane] > 0));
    // The tails, and one slot to stream into when the lane streams: never frozen at its tails.
    for (const lane of open)
      layers[lane] = layersFor(kept[lane] + Number(lanes[lane] > kept[lane]));
    const floor = { ...layers },
      weight = (lane: PoolLane) => lanes[lane] * tileBytes(texelBytes(lane)),
      weights = [...open].reduce((sum, lane) => sum + weight(lane), 0);
    let budget =
      budgetBytes / 2 - [...open].reduce((sum, lane) => sum + floor[lane] * layerBytes(lane), 0);
    // Under the layers' floor, each lane holds the tiles its share of the budget pays for, never
    // fewer than its tails and one to stream into: the floor, counted in tiles.
    const capped = laneCounts();
    if (budget < 0) {
      budget = 0;
      for (const lane of open) {
        const least = kept[lane] + Number(lanes[lane] > kept[lane]),
          share = Math.floor(
            ((budgetBytes / 2) * (weight(lane) / weights)) / tileBytes(texelBytes(lane)),
          );
        if (share < least) clamps.add('minimum');
        capped[lane] = Math.max(least, share);
      }
    }
    // The remainder by weight; a lane served under its share gives the rest back to the others.
    for (let round = 0; open.size && round < POOL_LANES.length; round++) {
      const total = [...open].reduce((sum, lane) => sum + weight(lane), 0);
      const share = (lane: PoolLane) =>
        Math.floor((budget * weight(lane)) / total / layerBytes(lane));
      const capped = [...open].filter(
        (lane) => share(lane) >= layersFor(lanes[lane]) - floor[lane],
      );
      if (!capped.length) {
        for (const lane of open) layers[lane] += share(lane);
        break;
      }
      for (const lane of capped) {
        layers[lane] = layersFor(lanes[lane]);
        budget -= (layers[lane] - floor[lane]) * layerBytes(lane);
        open.delete(lane);
      }
      if (!open.size) clamps.add('scene');
    }
    // The device refuses only tails it cannot hold: the slot to stream into gives way to its limit.
    for (const lane of POOL_LANES)
      if (typeof limit === 'number' && layers[lane] > limit) {
        if (limit < Math.max(1, layersFor(kept[lane])))
          throw new Error(
            `TEXTURE_POOL_DEVICE_LIMIT: ${kept[lane]} ${lane} tails, device allows ${limit} layers`,
          );
        layers[lane] = limit;
        clamps.add('device-limit');
      }
    const tiles = laneCounts();
    for (const lane of POOL_LANES)
      tiles[lane] = Math.min(layers[lane] * TILES_PER_LAYER, capped[lane] || Infinity);
    return { layers, tiles };
  };
  const color = atlas(demand.color, tails.color),
    data = atlas(demand.data, tails.data);
  const layers = { color: color.layers, data: data.layers },
    tiles = { color: color.tiles, data: data.tiles };
  const allocatedBytes = [layers.color, layers.data].reduce(
    (bytes, lanes) =>
      bytes + POOL_LANES.reduce((sum, lane) => sum + lanes[lane] * layerBytes(lane), 0),
    0,
  );
  const clamp =
    (['device-limit', 'minimum', 'scene'] as const).find((name) => clamps.has(name)) ?? null;
  return { budgetBytes, layers, tiles, allocatedBytes, clamp };
}
