import type { MeasuredWorld } from '../session/explorer.ts';
import type { Scene } from './scene.ts';

/**
 * The scene's background as the session's clear colour, a per-frame value like exposure: written
 * before the frame that first shows a new colour, the session kept. A session opens on the colour
 * of the moment (`world.ts`); a frame where it did not change compares one number.
 */
export function createWorldBackground(scene: Scene) {
  let written: number | undefined;
  return {
    /** Writes the colour when it differs from the last one written; false when the session
     *  cannot take it in place, and only a new one will show it. */
    write(session: MeasuredWorld) {
      const hex = scene.background?.getHex();
      if (hex === written) return true;
      written = hex;
      return session.setClearColor(hex);
    },
  };
}
