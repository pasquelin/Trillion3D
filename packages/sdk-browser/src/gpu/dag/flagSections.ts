import { LEVEL_QUEUES } from './shader/levelWgsl.ts';

/** Flag sections behind queue 0: the draw mask, the cone words, the live list, the candidate list
 *  (a light cut's drawn log), each one word per page (`shader/levelWgsl.ts`). */
export const PAGE_SECTIONS = 4;

/** Sections of a camera cut's `flags`: queue 0, the four page sections, the other queues, then
 *  each page's last use (`shader/lastUseWgsl.ts`); a light cut has all but the last. */
export const FLAG_SECTIONS = 1 + PAGE_SECTIONS + (LEVEL_QUEUES - 1) + 1;
