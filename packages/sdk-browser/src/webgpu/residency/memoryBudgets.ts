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

/** 512 MiB, split equally between the colour atlas and the data atlas, in 63.5 MiB layers. */
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
};

/**
 * Layers of each lane pool that the texture-pool budget yields: half the budget per atlas; in an
 * atlas every lane that has textures gets one layer — the minimum for each to show its queue —,
 * then the rest in proportion to the bytes its textures would take resident, a block texel
 * costing a quarter of an RGBA8 one, and never more layers than its tiles need, what a capped
 * lane leaves going to the others (`scene` when every lane is served under the budget). A lane no
 * texture takes has no layer. A budget under one layer per lane is raised to it, by name; above
 * the layer count the device accepts, a lane is brought back to that limit, by name.
 */
export function texturePoolFor(
  budgetBytes: number,
  device: { limits?: { maxTextureArrayLayers?: number } } | undefined,
  /** Tiles each lane's textures would hold at full residency — tails and streamed entries. */
  demand: AtlasLanes,
  texelBytes: (lane: PoolLane) => number,
): TexturePool {
  checkTexturePoolBudget(budgetBytes);
  const limit = device?.limits?.maxTextureArrayLayers;
  const clamps = new Set<PoolClamp>();
  const layerBytes = (lane: PoolLane) => poolLayerBytes(texelBytes(lane));
  const atlas = (lanes: LaneCounts) => {
    const layers = laneCounts();
    const open = new Set(POOL_LANES.filter((lane) => lanes[lane] > 0));
    for (const lane of open) layers[lane] = 1;
    let budget = budgetBytes / 2 - [...open].reduce((sum, lane) => sum + layerBytes(lane), 0);
    if (budget < 0) {
      clamps.add('minimum');
      budget = 0;
    }
    // The remainder by weight; a lane served under its share gives the rest back to the others.
    for (let round = 0; open.size && round < POOL_LANES.length; round++) {
      const weight = (lane: PoolLane) => lanes[lane] * tileBytes(texelBytes(lane));
      const total = [...open].reduce((sum, lane) => sum + weight(lane), 0);
      const share = (lane: PoolLane) =>
        Math.floor((budget * weight(lane)) / total / layerBytes(lane));
      const capped = [...open].filter(
        (lane) => share(lane) >= Math.ceil(lanes[lane] / TILES_PER_LAYER) - 1,
      );
      if (!capped.length) {
        for (const lane of open) layers[lane] += share(lane);
        break;
      }
      for (const lane of capped) {
        layers[lane] = Math.ceil(lanes[lane] / TILES_PER_LAYER);
        budget -= (layers[lane] - 1) * layerBytes(lane);
        open.delete(lane);
      }
      if (!open.size) clamps.add('scene');
    }
    for (const lane of POOL_LANES)
      if (typeof limit === 'number' && layers[lane] > limit) {
        layers[lane] = Math.max(1, limit);
        clamps.add('device-limit');
      }
    return layers;
  };
  const layers = { color: atlas(demand.color), data: atlas(demand.data) };
  const allocatedBytes = [layers.color, layers.data].reduce(
    (bytes, lanes) =>
      bytes + POOL_LANES.reduce((sum, lane) => sum + lanes[lane] * layerBytes(lane), 0),
    0,
  );
  const clamp =
    (['device-limit', 'minimum', 'scene'] as const).find((name) => clamps.has(name)) ?? null;
  return { budgetBytes, layers, allocatedBytes, clamp };
}
