import { REQUEST_PRIORITY_MAX } from './request.ts';

/**
 * THE FRAME STAMP OF A LIGHT CUT'S ASKED WORDS (`askedWord`, `shader/snapshotWgsl.ts`). A page's word
 * holds the frame's stamp in its high bits and its best priority plus one in the low ones, so a
 * word left by an earlier frame always loses the `atomicMax` to this frame's first ask, and no
 * word needs clearing between frames: a frame costs what its views ask for, never the catalogue.
 *
 * The stamp counts frames from 1 to `ASKED_STAMP_MAX`. When it wraps back to 1, a word may still
 * hold a larger stamp from before: that frame alone clears every word once, one word per catalogue
 * page, once every `ASKED_STAMP_MAX` frames — about 9.7 hours at 60 frames a second.
 */
/** Low bits of an asked word: the priority plus one, so that zero is never asked. */
export const ASKED_PRIORITY_BITS = Math.ceil(Math.log2(REQUEST_PRIORITY_MAX + 2));
/** The largest stamp: every bit above the priority's. */
export const ASKED_STAMP_MAX = 2 ** (32 - ASKED_PRIORITY_BITS) - 1;

/** The stamps of a light cut's frames, and the frame whose words must be cleared first. */
export function createAskedStamp() {
  let stamp = 0;
  return {
    /** The next frame's stamp, and whether its words are cleared before it asks. */
    next() {
      const wraps = stamp >= ASKED_STAMP_MAX;
      stamp = wraps ? 1 : stamp + 1;
      return { stamp, clear: wraps };
    },
  };
}
