/** The pixels a ribbon may span for one thread to draw it alone: the area of a tile of the reference's compute
 *  raster (32 by 32), the most that raster hands one thread of a segment. A ribbon that spans more is drawn by a
 *  group of threads (`hairRasterLarge`). */
export const HAIR_INLINE_PIXELS = 32 * 32
/** The threads of the group that draws one large ribbon, as an x by y grid: 32, the most threads the reference's
 *  compute raster shares a segment between; each takes every x-th pixel of every y-th row of it. */
export const HAIR_LARGE_LANES = [8, 4] as const

/** The bindings, in group 1 of the compute raster's module, of its tile parameters, its grid of tile counters, the tiles (their words, then
 *  their segments), the lists of the classified segments, and the compacted tiles (their words, then their segments). The large ribbons
 *  hold 4 and 5, the samples 2 and the band 3. */
export const HAIR_TILE_PARAMS_BINDING = 6
export const HAIR_TILE_GRID_BINDING = 7
export const HAIR_TILE_META_BINDING = 8
export const HAIR_TILE_PRIMS_BINDING = 9
export const HAIR_TILE_LIST_BINDING = 10
export const HAIR_TILE_META2_BINDING = 11
export const HAIR_TILE_PRIMS2_BINDING = 12

/** The segments of a tile of the compute raster, and the threads of the groups that bin, compact and draw them: one thread a segment of a tile. */
export const HAIR_TILE_CHUNK = 256

/** The shares `hairThreadsPerSegment` picks among, the least first. */
export const HAIR_THREADS_PER_SEGMENT = [2, 3, 4, 5, 6, 7, 8, 16, 32] as const

/** The threads a group gives a segment of a tile that holds `count` segments: the workgroup shared evenly, in the whole numbers up to 8 and then 16
 *  and 32, so that the threads of a group are all at work whether the tile holds a few long segments or many short ones. */
export const hairThreadsPerSegment = (count: number) => {
  let threads = 1
  for (const t of HAIR_THREADS_PER_SEGMENT)
    if (count <= Math.floor(HAIR_TILE_CHUNK / t)) threads = t
  return threads
}
