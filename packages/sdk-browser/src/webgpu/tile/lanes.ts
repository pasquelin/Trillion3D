import { createWebgpuTilePool, type WebgpuTilePool } from './pool.ts';
import type { WebgpuTilePageTable } from './pageTable.ts';
import {
  POOL_LANES,
  type LaneCounts,
  type PoolEncoding,
  type PoolLane,
} from '../../texture/blockFormats.ts';
import { resizeTileAtlas } from './atlasResize.ts';

/** A lane's pool, the tiles resident in it by id, and the eviction candidates of the image. */
export type Lane = { pool: WebgpuTilePool; resident: Map<number, number>; candidates: number[] };

/**
 * The pools of an atlas, one per lane its textures take: the lossless RGBA8 lane, the RGBA block
 * lane, the two-channel one. A lane with no layer has no pool and a 1×1 stand-in view at its
 * binding — the shader never reads it, since no texture names that lane. Each pool is sized by
 * the layers the budget gave its lane, and resized on its own.
 */
export function createTileLanes(
  device: Pick<GPUDevice, 'createTexture'>,
  options: {
    kind: 'color' | 'data';
    encoding: PoolEncoding;
    /** Layers of each lane's pool; a lane no texture takes has none, and no pool. */
    layers: LaneCounts;
    textures: readonly { lane: PoolLane }[];
  },
) {
  const { kind, encoding, textures } = options;
  const shape = (lane: PoolLane, layers: number) => ({
    kind,
    lane,
    format: encoding.formatOf(kind, lane),
    texelBytes: encoding.texelBytes(lane),
    layers,
  });
  const lanes = new Map<PoolLane, Lane>();
  for (const lane of POOL_LANES)
    if (options.layers[lane] > 0)
      lanes.set(lane, {
        pool: createWebgpuTilePool(device, shape(lane, options.layers[lane])),
        resident: new Map(),
        candidates: [],
      });
  for (const [lane, { pool }] of lanes) {
    const tails = textures.filter((texture) => texture.lane === lane).length;
    if (tails > pool.tiles)
      throw new Error(`TEXTURE_POOL_TAILS: ${tails} ${lane} textures, ${pool.tiles} tiles`);
  }
  const standInTexture = device.createTexture({
    label: `WG texture pool ${kind} stand-in`,
    size: { width: 4, height: 4, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
  const standIn = standInTexture.createView({ dimension: '2d-array' });
  const views = () => POOL_LANES.map((lane) => lanes.get(lane)?.pool.view ?? standIn);
  const pools = () => [...lanes.values()].map((lane) => lane.pool);
  return {
    lanes,
    pools,
    of(slot: number) {
      const lane = lanes.get(textures[slot].lane);
      if (!lane) throw new Error(`TEXTURE_POOL_LANE ${textures[slot].lane}`);
      return lane;
    },
    views,
    /** Every lane whose layers change gets a new pool that keeps its tiles; returns the evicted
     *  tiles and how many pools were replaced — none when the layers are those already held. */
    resize(
      target: Pick<GPUDevice, 'createTexture' | 'createCommandEncoder' | 'queue'>,
      layers: LaneCounts,
      pages: WebgpuTilePageTable,
    ) {
      let evicted = 0,
        replaced = 0;
      for (const [name, lane] of lanes) {
        if (layers[name] === lane.pool.layers) continue;
        replaced++;
        const result = resizeTileAtlas(
          target,
          shape(name, layers[name]),
          encoding.tapOf(name),
          lane.pool,
          pages,
          lane.resident,
        );
        lane.pool = result.pool;
        evicted += result.evicted;
      }
      return { evicted, replaced };
    },
    destroy() {
      for (const lane of lanes.values()) lane.pool.destroy();
      standInTexture.destroy();
    },
  };
}
