import type { MeasuredWorld } from '../session/explorer.ts';
import type { Scene } from './scene.ts';

/**
 * The scene's background as the session's clear colour, a per-frame value like exposure: a
 * change is written in place before the next frame, the session kept, and a frame where it did
 * not change reads one flag. A session opens on the colour of the moment (`world.ts`).
 */
export function createWorldBackground(scene: Scene) {
  let changed = false;
  return {
    /** The background was set or written: the next frame takes it. */
    changed() {
      changed = true;
    },
    /** Writes a changed colour; false when the session cannot, and only a new one will show it. */
    write(session: MeasuredWorld) {
      if (!changed) return true;
      changed = false;
      return session.setClearColor(scene.background?.getHex());
    },
  };
}
