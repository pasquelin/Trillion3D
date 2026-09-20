import { POOL_LAYER_BYTES } from './textureTiles.ts';
import { pageBufferCap } from './gpuPageResize.ts';

/**
 * Engine memory budgets, as in the reference: FIXED-size pools, set by the host and never read off
 * the machine — free memory changes every instant, a budget read at startup would be wrong five
 * minutes later. What a view asks beyond the pool renders coarser; nothing is refused, nothing
 * stops. A value that cannot be held as-is is brought back to what can, and the reason is published
 * (`clamp`).
 */
export const DEFAULT_GEOMETRY_POOL_BUDGET = 512 * 1024 * 1024;
/** 512 MiB, split equally between the colour atlas and the data atlas, in 63.5 MiB layers. */
export const DEFAULT_TEXTURE_POOL_BUDGET = 512 * 1024 * 1024;
/** CPU milliseconds a frame's tile pass may spend copying tiles: the same order as the shadow
 *  stage's budget, and the reference's fixed number of tile uploads per frame in the frame's own
 *  unit. What it defers shows its coarser resident level until the next pass. */
export const DEFAULT_TEXTURE_UPLOAD_MS = 1;

/** Why a pool does not make the requested size, or `null` when it does. */
export type PoolClamp =
  'root-cover' | 'scene' | 'page-cap' | 'device-limit' | 'minimum' | 'ceiling' | null;

export type GeometryPool = {
  /** Bytes requested by the host, and the page slots the pool draws from them. */
  budgetBytes: number;
  slots: number;
  pageBytes: number;
  allocatedBytes: number;
  clamp: PoolClamp;
};

const checkBudget = (bytes: number, name: string) => {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error(name);
};

/**
 * Geometry page-pool slots for a budget in bytes — `r.Nanite.Streaming.
 * StreamingPoolSize` in the reference, 512 MB by default. Root coverage always fits, like its
 * resident root pages outside the pool: a budget smaller than that cover is raised to it, by name.
 * A scene smaller than the budget takes only what it has, and a page cap (`maxResidentPages`, the
 * one benches and tests use) also bounds it, as does the session ceiling (`ceilingSlots`, what the
 * drawable-page tables have sized). Only the DEVICE limit can refuse, when even root coverage does
 * not fit.
 */
export function geometryPoolFor(options: {
  budgetBytes: number;
  pageBytes: number;
  uniquePages: number;
  rootPages: number;
  maxResidentPages?: number;
  ceilingSlots?: number;
  limits?: Parameters<typeof pageBufferCap>[0];
}): GeometryPool {
  const { budgetBytes, pageBytes, uniquePages, maxResidentPages, ceilingSlots, limits } = options;
  checkBudget(budgetBytes, 'INVALID_GEOMETRY_POOL_BUDGET');
  const floor = Math.max(1, options.rootPages);
  let slots = Math.floor(budgetBytes / pageBytes),
    clamp: PoolClamp = null;
  if (maxResidentPages !== undefined && maxResidentPages < slots) {
    slots = maxResidentPages;
    clamp = 'page-cap';
  }
  if (uniquePages < slots) {
    slots = uniquePages;
    clamp = 'scene';
  }
  if (ceilingSlots !== undefined && ceilingSlots < slots) {
    slots = ceilingSlots;
    clamp = 'ceiling';
  }
  if (slots < floor) {
    slots = floor;
    clamp = 'root-cover';
  }
  const deviceBytes = pageBufferCap(limits);
  const deviceSlots = Math.floor(deviceBytes / pageBytes);
  if (deviceSlots < slots) {
    if (deviceSlots < floor)
      throw new Error(
        `GEOMETRY_POOL_DEVICE_LIMIT: ${floor} root pages of ${pageBytes} bytes, device allows ${deviceBytes}`,
      );
    slots = deviceSlots;
    clamp = 'device-limit';
  }
  return { budgetBytes, slots, pageBytes, allocatedBytes: slots * pageBytes, clamp };
}

export type TexturePool = {
  budgetBytes: number;
  /** Layers per atlas, and bytes of both atlases. */
  layers: number;
  allocatedBytes: number;
  clamp: PoolClamp;
};

/**
 * Layers per atlas that the texture-pool budget yields. Below one layer per atlas — the minimum for
 * every texture to show its queue — the pool is raised to one layer, by name; above the layer count
 * the device accepts, it is brought back to that limit, by name.
 */
export function texturePoolFor(
  budgetBytes: number,
  device: { limits?: { maxTextureArrayLayers?: number } } | undefined,
): TexturePool {
  checkBudget(budgetBytes, 'INVALID_TEXTURE_POOL_BUDGET');
  let layers = Math.floor(budgetBytes / 2 / POOL_LAYER_BYTES),
    clamp: PoolClamp = null;
  if (layers < 1) {
    layers = 1;
    clamp = 'minimum';
  }
  const limit = device?.limits?.maxTextureArrayLayers;
  if (typeof limit === 'number' && layers > limit) {
    layers = Math.max(1, limit);
    clamp = 'device-limit';
  }
  return { budgetBytes, layers, allocatedBytes: 2 * layers * POOL_LAYER_BYTES, clamp };
}
