/** The pixels a ribbon may span for one thread to draw it alone: the area of a tile of the reference's compute
 *  raster (32 by 32), the most that raster hands one thread of a segment. A ribbon that spans more is drawn by a
 *  group of threads (`hairRasterLarge`). */
export const HAIR_INLINE_PIXELS = 32 * 32
/** The threads of the group that draws one large ribbon, as an x by y grid: 32, the most threads the reference's
 *  compute raster shares a segment between; each takes every x-th pixel of every y-th row of it. */
export const HAIR_LARGE_LANES = [8, 4] as const
