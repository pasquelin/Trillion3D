import type { PhysicsBudget } from '../../../../sdk-core/src/physics/index.ts';
import { createWorldNotices } from '../diagnostic/worldNotices.ts';
import {
  DIAGNOSTICS,
  type EngineError,
  type FrameMetrics,
} from '../../../../sdk-core/src/index.ts';
import { engineErrorOf } from '../../../../sdk-core/src/contracts/errorCodes.ts';
import type { MeasuredWorld } from '../session/explorer.ts';
import type { WorldRenderer } from '../capability/worldReady.ts';
import { DEFAULT_GEOMETRY_POOL_BUDGET } from '../../residency/pools.ts';
import { DEFAULT_TEXTURE_POOL_BUDGET } from '../../webgpu/residency/memoryBudgets.ts';
import { raycastTreeBudget } from '../../../../sdk-core/src/world/object/raycastTrees.ts';

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
  session: { readonly explorer: MeasuredWorld | null },
  frames: { readonly last: FrameMetrics | null },
  renderer: () => WorldRenderer | null,
  physics: PhysicsBudget,
) {
  let pending = false;
  const rebalance = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      void session.explorer?.setMemoryBudgets({
        geometryPoolBytes: pools.geometryPool,
        texturePoolBytes: pools.texturePool,
      });
    });
  };
  // What the last frame published, `null` or `undefined` when it held no such pool.
  const held = (key: string) => (frames.last as Record<string, number | null> | null)?.[key];
  return {
    /** The physics envelopes (bodies, triangles, decorative bodies, memory), read once when the
     *  physics starts; exceeding one raises `PHYSICS_BUDGET`. */
    physics,
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
    /** Bytes of GPU memory kept for texture pages, `null` on an engine without a texture pool
     *  (WebGL2); set it to change the envelope. */
    get texturePool(): number | null {
      if (renderer() === 'webgl2') return null;
      return held('texturePoolBytes') ?? pools.texturePool ?? DEFAULT_TEXTURE_POOL_BUDGET;
    },
    set texturePool(bytes: number) {
      pools.texturePool = Math.min(bytes, DEFAULT_TEXTURE_POOL_BUDGET);
      rebalance();
    },
    /** Bytes of CPU memory `raycast` keeps for triangle trees, shared by every world on the page;
     *  past it the tree cast at least recently is dropped. Set it to change the envelope. */
    get raycastTrees() {
      return raycastTreeBudget.bytes;
    },
    set raycastTrees(bytes: number) {
      raycastTreeBudget.bytes = bytes;
    },
  };
}

/** The modes a page may name: every diagnostic the engine offers, and `triangles`. */
const WORLD_MODES = [
  ...Object.entries(DIAGNOSTICS).flatMap(([name, { available }]) => (available ? [name] : [])),
  'triangles',
];

/**
 * `world.diagnostic`: the view mode, applied to every session the world opens, and the world's
 * own channel, whose notices reach every page channel (`worldNotices.ts`). A mode the engine
 * does not know, or one the session in place refuses, is said once on the console and ignored:
 * the view keeps the mode it had, and a session opening later never inherits it.
 */
export function worldDiagnostic(explorer: () => MeasuredWorld | null) {
  let mode = 'beauty',
    sessions = 0,
    error: EngineError | null = null;
  const said = new Set<string>();
  const warn = (text: string) => {
    if (said.has(text)) return;
    said.add(text);
    console.warn(`[trillion3d] world.diagnostic.mode: ${text}`);
  };
  // `triangles` is the page's word for the per-triangle view, which the engine names `wireframe`
  // (one colour per submitted triangle, `triangleDiagnostic.ts`).
  const engineMode = (name: string) => (name === 'triangles' ? 'wireframe' : name) as never;
  /** Puts `name` on `session`; false, said on the console, when the session refuses it. */
  const put = (session: MeasuredWorld, name: string) => {
    try {
      session.setDiagnostic(engineMode(name));
      return true;
    } catch (error) {
      warn(`'${name}' refused by this session (${(error as Error).message})`);
      return false;
    }
  };
  const handle = {
    /** The view mode: `'beauty'` for the normal image, or a mode that shows how the engine works. */
    get mode() {
      return mode;
    },
    set mode(next: string) {
      if (!WORLD_MODES.includes(next)) {
        warn(`unknown mode ${JSON.stringify(next)}; one of ${WORLD_MODES.join(', ')}`);
        return;
      }
      const session = explorer();
      if (!session || put(session, next)) mode = next;
    },
    /** Sessions the world has opened so far: a change that reopens one shows here. */
    get sessions() {
      return sessions;
    },
    /** Why the last session could not open, as a named engine error: its `code` is one of those
     *  documented on `EngineError` (`WEBGPU_LOST` when WebGPU lost its device), or
     *  `SESSION_OPEN_FAILED` for a reason without one. An `EngineError` of a documented code is
     *  the one thrown; any other error is converted, and the error thrown is then in
     *  `details.cause`. `null` from the start of each opening, and when nothing is tried. */
    get error() {
      return error;
    },
    /** Every view mode the current renderer offers. */
    get modes() {
      const current = explorer();
      const modes = current ? Object.keys(current.diagnostics) : ['beauty'];
      return modes.includes('wireframe') ? [...modes, 'triangles'] : modes;
    },
  };
  return {
    /** What the page holds: the view mode, read and written; the sessions opened and why the
     *  last one failed, read only. */
    handle,
    notices: createWorldNotices(),
    /** Puts the mode on a session just opened; the world's own, never the page's. A mode this
     *  session refuses falls back to `beauty`, so an opening never fails on it. */
    apply(opened: MeasuredWorld) {
      sessions++;
      if (mode !== 'beauty' && !put(opened, mode)) mode = 'beauty';
    },
    /** A session that could not open, or a scene that could not resolve: named on the handle and
     *  said on the console with the error thrown, stack included. An engine error is kept as it
     *  is, and a bare documented code — the `WEBGPU_LOST` of the WebGPU renderer — becomes that
     *  code; anything else is `SESSION_OPEN_FAILED`. */
    failed(cause: unknown) {
      error = engineErrorOf(cause, 'SESSION_OPEN_FAILED', "The world's session failed to open");
      console.error('World session failed', cause);
    },
    /** A session is about to open, or none is tried: a failure that may no longer hold is no
     *  longer shown. */
    opening() {
      error = null;
    },
  };
}
