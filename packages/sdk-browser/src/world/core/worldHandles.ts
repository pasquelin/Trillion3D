import { createWorldNotices } from '../diagnostic/worldNotices.ts';
import type { FrameMetrics } from '../../../../sdk-core/src/index.ts';
import type { MeasuredWorld } from '../session/explorer.ts';
import {
  DEFAULT_GEOMETRY_POOL_BUDGET,
  DEFAULT_TEXTURE_POOL_BUDGET,
} from '../../webgpu/residency/memoryBudgets.ts';

export { worldControlsHandle } from './worldControlsHandle.ts';

/** The pools a page asks for, kept to open every later session with them. */
export type Pools = { geometryPool?: number; texturePool?: number };

/**
 * `world.budget`: the fixed pools, as properties. A write is clamped to its ceiling and applied
 * with the session's `setMemoryBudgets`; two writes before the next frame make one rebalance. A
 * read is what the last frame held, or what was asked before the first.
 */
export function worldBudget(
  pools: Pools,
  explorer: () => MeasuredWorld | null,
  last: () => FrameMetrics | null,
) {
  let pending = false;
  const rebalance = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      void explorer()?.setMemoryBudgets({
        geometryPoolBytes: pools.geometryPool,
        texturePoolBytes: pools.texturePool,
      });
    });
  };
  const held = (key: string) =>
    (last() as Record<string, number | null | undefined> | null)?.[key] ?? null;
  return {
    /** The largest pools a world may ask for: the engine's starting budgets. */
    get geometryPoolCeiling() {
      return DEFAULT_GEOMETRY_POOL_BUDGET;
    },
    /** The largest texture pool a world may ask for, in bytes. */
    get texturePoolCeiling() {
      return DEFAULT_TEXTURE_POOL_BUDGET;
    },
    /** Bytes of GPU memory kept for geometry pages; set it to change the envelope. */
    get geometryPool() {
      return held('geometryPoolBytes') ?? pools.geometryPool ?? DEFAULT_GEOMETRY_POOL_BUDGET;
    },
    set geometryPool(bytes: number) {
      pools.geometryPool = Math.min(bytes, DEFAULT_GEOMETRY_POOL_BUDGET);
      rebalance();
    },
    /** Bytes of GPU memory kept for texture pages; set it to change the envelope. */
    get texturePool() {
      return held('texturePoolBytes') ?? pools.texturePool ?? DEFAULT_TEXTURE_POOL_BUDGET;
    },
    set texturePool(bytes: number) {
      pools.texturePool = Math.min(bytes, DEFAULT_TEXTURE_POOL_BUDGET);
      rebalance();
    },
  };
}

/** `world.diagnostic`: the view mode, applied to every session the world opens, and the world's
 *  own channel, whose notices reach every page channel (`worldNotices.ts`). */
export function worldDiagnostic(explorer: () => MeasuredWorld | null) {
  let mode = 'beauty',
    sessions = 0;
  // `triangles` is the page's word for the per-triangle view, which the engine names `wireframe`
  // (one colour per submitted triangle, `triangleDiagnostic.ts`).
  const engineMode = (name: string) => (name === 'triangles' ? 'wireframe' : name) as never;
  const handle = {
    /** The view mode: `'beauty'` for the normal image, or a mode that shows how the engine works. */
    get mode() {
      return mode;
    },
    set mode(next: string) {
      explorer()?.setDiagnostic(engineMode(next));
      mode = next;
    },
    /** Sessions the world has opened so far: a change that reopens one shows here. */
    get sessions() {
      return sessions;
    },
    /** Every view mode the current renderer offers. */
    get modes() {
      const current = explorer();
      const modes = current ? Object.keys(current.diagnostics) : ['beauty'];
      return modes.includes('wireframe') ? [...modes, 'triangles'] : modes;
    },
  };
  return {
    /** What the page holds: the mode, read and written. */
    handle,
    notices: createWorldNotices(),
    /** Puts the mode on a session just opened; the world's own, never the page's. */
    apply(opened: MeasuredWorld) {
      sessions++;
      if (mode !== 'beauty') opened.setDiagnostic(engineMode(mode));
    },
  };
}
