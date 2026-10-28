/** How far behind the nearest strand the surfaces' depth is put: the passes that read the depth beside
 *  the strands (the screen-space ones) need no more than a pixel the strands cover to be behind them,
 *  and the bias keeps the strands' own comparison against it from rejecting them. */
export const HAIR_DEPTH_BIAS = 0.001
