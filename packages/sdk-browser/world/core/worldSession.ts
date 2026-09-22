import type { MeasuredWorld } from '../../explorer.ts';
import type { FrameMetrics } from '../../../sdk-core/index.ts';

/** What the families that read a world's engine reach it by, without the page holding it. */
type Access = { session: () => MeasuredWorld | null; last: () => FrameMetrics | null };
const worlds = new WeakMap<object, Access>();

export const registerWorld = (world: object, access: Access) => {
  worlds.set(world, access);
};

/** The session drawing `world` now; a world that draws nothing yet is refused by name. */
export function sessionOf(world: object): MeasuredWorld {
  const session = worlds.get(world)?.session();
  if (!session)
    throw new Error('This world draws nothing yet: add an object or load a model first');
  return session;
}

/** The metrics of the last frame `world` drew, null before its first. */
export const lastFrameOf = (world: object) => worlds.get(world)?.last() ?? null;

/** The one refusal of a session's page wait that says only that the view moved under it. */
const VIEW_MOVED = 'CAPTURE_CHANGED_DURING_FLUSH';
const nextFrame = () =>
  new Promise<void>((resolve) =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(() => resolve())
      : resolve(),
  );

/**
 * `world.awaitPages`: resolves once the pages the CURRENT view reads are resident. The view may
 * move while it waits — an orbit, a resize, the world's own loop —: the wait then follows it to
 * the next frame's view instead of failing. The strict page-and-capture flush, which refuses a
 * view that changed, stays the measurement entry's (`explorerLifecycle.ts`).
 */
export async function awaitViewPages(
  runtime: { settled(): Promise<void> },
  session: () => MeasuredWorld | null,
) {
  for (;;) {
    await runtime.settled();
    try {
      await session()?.awaitPages();
      return;
    } catch (error) {
      if ((error as Error)?.message !== VIEW_MOVED) throw error;
      await nextFrame();
    }
  }
}
