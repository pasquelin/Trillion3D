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
    /** Writes the colour when it differs from the last one written; when the session cannot
     *  take it in place, asks `reopen` for a new one, after the frame this one draws. */
    write(session: MeasuredWorld, reopen: () => void) {
      const hex = scene.background?.getHex();
      if (hex === written) return;
      written = hex;
      if (!session.setClearColor(hex)) queueMicrotask(reopen);
    },
  };
}
