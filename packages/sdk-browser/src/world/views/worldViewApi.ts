import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { createWorldViews, ViewRect } from './worldViews.ts';

/** Adds the new view accessors without evaluating them into stale values through an object spread. */
export function worldViewApi<World extends object>(
  world: World,
  views: ReturnType<typeof createWorldViews>,
) {
  const api = {
    /** Adds a camera of this scene in a CSS-pixel rectangle on this canvas, under the same budgets. */
    addView: views.addView,
    /** Subtrees omitted from the main camera and its shadows; other views remain unchanged. */
    get exclude(): readonly Object3D[] {
      return views.exclude;
    },
    set exclude(nodes: readonly Object3D[]) {
      views.exclude = nodes;
    },
    /** The main camera rectangle in CSS pixels; null (the default) fills the canvas. */
    get rect(): ViewRect | null {
      return views.rect;
    },
    set rect(rect: ViewRect | null) {
      views.rect = rect;
    },
  };
  return Object.defineProperties(world, Object.getOwnPropertyDescriptors(api)) as World &
    typeof api;
}

/** Steps every enabled view controller once, with the same delta as animation and physics. */
export function viewControllers(
  main: { autoUpdate: boolean; update(delta: number): void },
  views: { step(delta: number): void },
) {
  return {
    autoUpdate: true,
    update(delta: number) {
      if (main.autoUpdate) main.update(delta);
      views.step(delta);
    },
  };
}
