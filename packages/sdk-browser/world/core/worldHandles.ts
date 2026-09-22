import { createWorldNotices } from '../diagnostic/worldNotices.ts';
import type { FrameMetrics } from '../../../sdk-core/index.ts';
import { Vector3 } from '../../../sdk-core/world/math/vector3.ts';
import type { Camera } from '../../../sdk-core/world/camera/camera.ts';
import type { MeasuredWorld } from '../../explorer.ts';
import { worldControls, type WorldControls } from './worldCamera.ts';
import {
  DEFAULT_GEOMETRY_POOL_BUDGET,
  DEFAULT_TEXTURE_POOL_BUDGET,
} from '../../webgpuMemoryBudgets.ts';

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
    get texturePoolCeiling() {
      return DEFAULT_TEXTURE_POOL_BUDGET;
    },
    get geometryPool() {
      return held('geometryPoolBytes') ?? pools.geometryPool ?? DEFAULT_GEOMETRY_POOL_BUDGET;
    },
    set geometryPool(bytes: number) {
      pools.geometryPool = Math.min(bytes, DEFAULT_GEOMETRY_POOL_BUDGET);
      rebalance();
    },
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
  let mode = 'beauty';
  // `triangles` is the page's word for the per-triangle view, which the engine names `wireframe`
  // (one colour per submitted triangle, `triangleDiagnostic.ts`).
  const engineMode = (name: string) => (name === 'triangles' ? 'wireframe' : name) as never;
  const handle = {
    get mode() {
      return mode;
    },
    set mode(next: string) {
      explorer()?.setDiagnostic(engineMode(next));
      mode = next;
    },
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
      if (mode !== 'beauty') opened.setDiagnostic(engineMode(mode));
    },
  };
}

type Controller = NonNullable<ReturnType<typeof worldControls>>;

/**
 * `world.controls`: the controller driving the world's camera from the canvas, live. Changing
 * `kind` or `enabled` releases the one in place and makes the next; a gesture redraws.
 */
export function worldControlsHandle(
  initial: WorldControls,
  camera: () => Camera,
  surface: HTMLElement,
  invalidate: () => void,
) {
  let kind = initial,
    enabled = true,
    current: Controller | null = null;
  const standingTarget = new Vector3();
  const rebuild = () => {
    const target = (current as { target?: Vector3 } | null)?.target ?? standingTarget;
    standingTarget.copy(target);
    current?.dispose();
    current = enabled ? worldControls(kind, camera(), surface) : null;
    const pivot = current as { target?: Vector3; update?: () => boolean } | null;
    if (pivot?.target) {
      pivot.target.copy(standingTarget);
      pivot.update?.();
    }
    current?.addEventListener('change', invalidate);
  };
  rebuild();
  return {
    get kind() {
      return kind;
    },
    set kind(next: WorldControls) {
      kind = next;
      rebuild();
    },
    get enabled() {
      return enabled;
    },
    set enabled(on: boolean) {
      enabled = on;
      rebuild();
    },
    /** The point a pivot controller turns around. */
    get target(): Vector3 {
      return (current as { target?: Vector3 } | null)?.target ?? standingTarget;
    },
    /** Integrates a steered controller over `delta` seconds; a pivot one re-reads its pose. */
    update(delta = 0) {
      (current as { update?: (d: number) => boolean } | null)?.update?.(delta);
    },
    /** The world's camera changed: the controller follows it. */
    follow: rebuild,
    dispose() {
      current?.dispose();
      current = null;
    },
  };
}
