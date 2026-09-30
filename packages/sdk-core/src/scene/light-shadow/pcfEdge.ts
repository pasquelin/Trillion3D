/** Texels around a read point that the PCF's bilinear footprints reach, on each axis: its taps'
 *  farthest offset on an axis, 0.975, and half a texel. A point nearer a page's edge than this
 *  reads the neighbour across it (`shadowPcf`). */
export const PCF_EDGE_TEXELS = 1.5;
