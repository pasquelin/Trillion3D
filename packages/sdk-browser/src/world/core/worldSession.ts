import type { MeasuredWorld } from '../session/explorer.ts';
import type { FrameMetrics, JobProgress } from '../../../../sdk-core/src/index.ts';

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

/** What `world.awaitPages` may be told: who hears the pages of the view land. */
export type PageProgress = {
  /** Hears `{ phase: 'pages', completed, total }` as each page the view lacked lands, the last
   *  event once they all have. The event is a `JobProgress`, as `scene.load` reports. */
  onProgress?: (event: JobProgress) => void;
};

/**
 * `world.awaitPages`: resolves once the pages the current view reads are resident. It takes no
 * picture (`image: false`): a world whose loop redraws every frame — a large world streaming, an
 * animated scene — never holds an image still long enough to read one back, and a wait that asked
 * for it never settled (#408). A capture reads its own image (`capture.buffer`). `onProgress`
 * hears `pages` as each one it lacked lands.
 */
export async function awaitViewPages(
  runtime: { settled(): Promise<void> },
  session: () => MeasuredWorld | null,
  onProgress?: (event: JobProgress) => void,
) {
  await runtime.settled();
  await session()?.awaitPages({ image: false, onProgress });
}
