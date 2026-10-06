/**
 * Time constant, in milliseconds, of the exponential filter the view ahead reads the velocity
 * through: about six frames at 60 Hz, so one frame's jitter moves the pages asked for ahead by a
 * sixth of it, and a bend of the path is followed within a tenth of a second.
 */
export const AHEAD_SMOOTHING_MS = 100
