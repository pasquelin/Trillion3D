/** The most a reactive value lets the current image take: FSR 2 holds it below 1, so a
 *  transparent never drops its history whole and still averages its jitter. */
export const REACTIVE_MAX = 0.9;
