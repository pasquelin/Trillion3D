/**
 * The measurement resolution, declared once.
 *
 * 2496 × 1404, the internal resolution of the published profile the pass shapes are
 * compared against — comparing milliseconds taken at two different resolutions
 * means nothing. What we do NOT match, and must not let anyone believe: they upsample that image
 * to 4K by their temporal super-sampling; ours accumulates at native resolution and upsamples
 * nothing. It is the internal render that is the same size, not the output.
 */
export const MEASURE_WIDTH = 2496
export const MEASURE_HEIGHT = 1404
