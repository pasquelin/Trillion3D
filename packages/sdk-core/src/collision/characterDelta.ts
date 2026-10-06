/** Seconds one call lives at most, the usual clamp of a fixed-step loop: a stall (a hidden tab,
 *  a long frame) resumes where it stopped, 0.25 s later at most, instead of spending one frame on
 *  the whole stall. Any shorter delta is caught up in full, so a page at 5 fps walks as fast. */
export const MAX_CHARACTER_DELTA = 0.25
