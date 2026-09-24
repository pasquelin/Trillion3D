import type { MeasuredWorld } from '../session/explorer.ts';
import type { WorldRenderer } from '../capability/worldReady.ts';
import type { WorldOptions } from './worldOptions.ts';

/** What of the world's runtime the switches reach: its open session, and its reopening. */
interface SwitchedRuntime {
  readonly explorer: MeasuredWorld | null;
  renew(): void;
}

/**
 * The world's render switches — bounced light, temporal antialiasing —: held by the world, given
 * to every session it opens (`held`), and written into the open one in place, the session
 * reopened only where it cannot take one.
 */
export function worldSwitches(
  options: WorldOptions,
  runtime: () => SwitchedRuntime,
  device: { readonly renderer: WorldRenderer | null },
  invalidate: () => void,
) {
  const held = { bounce: false, temporalAntialiasing: options.temporalAntialiasing !== false };
  return {
    held,
    /** Light bounced off the surfaces, traced against the resident proxy; off by default. A
     *  change is applied in place on a path that carries it, and taken by the next opening on
     *  one that does not. */
    get bounce() {
      return held.bounce;
    },
    set bounce(on: boolean) {
      if (on === held.bounce) return;
      held.bounce = on;
      const session = runtime().explorer;
      if (session && !session.setBounce(on)) runtime().renew();
      invalidate();
    },
    /** Temporal antialiasing: sub-pixel jitter accumulated over frames; on by default. Written, it
     *  takes effect at the next frame, history dropped, no session reopened. Read, it is what the
     *  image carries: false on WebGL2, which has none, and while the program compiles after it was
     *  turned on; before a session opens, what the page asked. */
    get temporalAntialiasing() {
      const session = runtime().explorer;
      if (session) return session.temporalAntialiasing();
      return held.temporalAntialiasing && device.renderer !== 'webgl2';
    },
    set temporalAntialiasing(on: boolean) {
      if (on === held.temporalAntialiasing) return;
      held.temporalAntialiasing = on;
      runtime().explorer?.setTemporalAntialiasing(on);
      invalidate();
    },
  };
}
