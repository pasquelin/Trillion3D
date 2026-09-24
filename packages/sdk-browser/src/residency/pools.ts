import { pageBufferCap } from '../gpu/page/resize.ts';

/**
 * Engine memory budgets, as in the reference: FIXED-size pools, set by the host and never read off
 * the machine — free memory changes every instant, a budget read at startup would be wrong five
 * minutes later. What a view asks beyond the pool renders coarser; nothing is refused, nothing
 * stops. A value that cannot be held as-is is brought back to what can, and the reason is published
 * (`clamp`). Both engines draw their geometry pool by this rule; the texture pools are the WebGPU
 * engine's (`../webgpu/residency/memoryBudgets.ts`).
 */
export const DEFAULT_GEOMETRY_POOL_BUDGET = 512 * 1024 * 1024;

/** Why a pool does not make the requested size, or `null` when it does. */
export type PoolClamp =
  'root-cover' | 'scene' | 'page-cap' | 'device-limit' | 'minimum' | 'ceiling' | null;

/** The geometry pool as it stands: slots, page size and bytes held. */ export type GeometryPool = {
  /** Bytes requested by the host, and the page slots the pool draws from them. */
  budgetBytes: number;
  /** Page slots. */ slots: number;
  /** Bytes per page. */ pageBytes: number;
  /** Bytes held. */ allocatedBytes: number;
  /** Why the size was limited. */ clamp: PoolClamp;
};

const checkBudget = (bytes: number, name: string) => {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error(name);
};
/** A texture budget refused by name before any pool is drawn from it. */
export const checkTexturePoolBudget = (bytes: number) =>
  checkBudget(bytes, 'INVALID_TEXTURE_POOL_BUDGET');

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
